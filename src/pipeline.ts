import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import {
	linkAllFilesInMetafile,
	performAction,
	performActions,
} from "./action.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	isAnyMatchedDecision,
	SaveResult,
	UNKNOWN_TRACKER,
} from "./constants.js";
import {
	findPotentialNestedRoots,
	findSearcheesFromAllDataDirs,
} from "./dataFiles.js";
import { db } from "./db.js";
import {
	assessCandidate,
	assessCandidateCaching,
	ResultAssessment,
} from "./decide.js";
import {
	IndexerStatus,
	updateIndexerStatus,
	updateSearchTimestamps,
} from "./indexers.js";
import { Label, logger } from "./logger.js";
import {
	filterByContent,
	filterDupesFromSimilar,
	filterTimestamps,
} from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { isOk } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromMetafile,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	Searchee,
	SearcheeLabel,
	SearcheeWithLabel,
} from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	getInfoHashesToExclude,
	getTorrentByCriteria,
	getSimilarTorrentsByName,
	indexNewTorrents,
	loadTorrentDirLight,
	parseInfoFromSavedTorrent,
	parseTorrentFromFilename,
	TorrentLocator,
} from "./torrent.js";
import {
	CachedSearch,
	getSearchString,
	queryRssFeeds,
	searchTorznab,
} from "./torznab.js";
import {
	areMediaTitlesSimilar,
	formatAsList,
	getLogString,
	isTruthy,
	sanitizeInfoHash,
	wait,
} from "./utils.js";
import { Metafile } from "./parseTorrent.js";
import { getClient } from "./clients/TorrentClient.js";
import { dirname } from "path";

export interface Candidate {
	guid: string;
	link: string;
	size: number;
	name: string;
	tracker: string;
	pubDate: number;
	indexerId?: number;
}

export interface AssessmentWithTracker {
	assessment: ResultAssessment;
	tracker: string;
}

interface FoundOnOtherSites {
	searchedIndexers: number;
	matches: number;
}

type FullMatches = [
	SearcheeWithLabel,
	Decision.MATCH | Decision.MATCH_SIZE_ONLY,
][];
type PartialMatches = [SearcheeWithLabel, Decision.MATCH_PARTIAL][];

type InjectSummary = {
	TOTAL: number;
	INJECTED: number;
	FULL_MATCHES: number;
	PARTIAL_MATCHES: number;
	BLOCKED: number;
	ALREADY_EXISTS: number;
	INCOMPLETE_CANDIDATES: number;
	INCOMPLETE_SEARCHEES: number;
	FAILED: number;
	UNMATCHED: number;
	FOUND_BAD_FORMAT: boolean;
	FLAT_LINKING: boolean;
};

async function assessCandidates(
	candidates: Candidate[],
	searchee: SearcheeWithLabel,
	hashesToExclude: string[],
): Promise<AssessmentWithTracker[]> {
	const assessments: AssessmentWithTracker[] = [];
	for (const result of candidates) {
		const assessment = await assessCandidateCaching(
			result,
			searchee,
			hashesToExclude,
		);
		assessments.push({ assessment, tracker: result.tracker });
	}
	return assessments;
}

async function findOnOtherSites(
	searchee: SearcheeWithLabel,
	hashesToExclude: string[],
	cachedSearch: CachedSearch,
	progress: string,
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.title })
		.onConflict("name")
		.ignore();

	const response = await searchTorznab(searchee, cachedSearch, progress);
	const cachedIndexers = cachedSearch.indexerCandidates.length;
	const searchedIndexers = response.length - cachedIndexers;
	cachedSearch.indexerCandidates = response;

	const results: Candidate[] = response.flatMap((e) =>
		e.candidates.map((candidate) => ({
			...candidate,
			indexerId: e.indexerId,
		})),
	);

	if (response.length) {
		logger.verbose({
			label: Label.DECIDE,
			message: `Assessing ${results.length} candidates for ${searchee.title} from ${searchedIndexers}|${cachedIndexers} indexers by search|cache`,
		});
	}
	const assessments = await assessCandidates(
		results,
		searchee,
		hashesToExclude,
	);

	const { rateLimited, notRateLimited } = assessments.reduce(
		(acc, cur, idx) => {
			const candidate = results[idx];
			if (cur.assessment.decision === Decision.RATE_LIMITED) {
				acc.rateLimited.add(candidate.indexerId!);
				acc.notRateLimited.delete(candidate.indexerId!);
			}
			return acc;
		},
		{
			rateLimited: new Set<number>(),
			notRateLimited: new Set(response.map((r) => r.indexerId)),
		},
	);

	const matches = assessments.filter((e) =>
		isAnyMatchedDecision(e.assessment.decision),
	);
	const actionResults = await performActions(searchee, matches);

	await updateSearchTimestamps(searchee.title, Array.from(notRateLimited));

	await updateIndexerStatus(
		IndexerStatus.RATE_LIMITED,
		Date.now() + ms("1 hour"),
		Array.from(rateLimited),
	);

	const zipped: [ResultAssessment, string, ActionResult][] = zip(
		matches.map((m) => m.assessment),
		matches.map((m) => m.tracker),
		actionResults,
	);
	sendResultsNotification(searchee, zipped);

	return { searchedIndexers, matches: matches.length };
}

async function findMatchesBatch(
	searchees: SearcheeWithLabel[],
	hashesToExclude: string[],
) {
	const { delay } = getRuntimeConfig();

	let totalFound = 0;
	let prevSearchTime = 0;
	const cachedSearch: CachedSearch = { q: null, indexerCandidates: [] };
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			const sleepTime = delay * 1000 - (Date.now() - prevSearchTime);
			if (sleepTime > 0) {
				await wait(sleepTime);
			}
			const searchTime = Date.now();

			const { searchedIndexers, matches } = await findOnOtherSites(
				searchee,
				hashesToExclude,
				cachedSearch,
				progress,
			);
			totalFound += matches;

			// if all indexers were rate limited or cached, don't sleep
			if (searchedIndexers === 0) continue;
			prevSearchTime = searchTime;
		} catch (e) {
			const searcheeLog = getLogString(searchee, chalk.bold.white);
			logger.error({
				label: searchee.label,
				message: `${progress}Error searching for ${searcheeLog}`,
			});
			logger.debug(e);
		}
	}
	return totalFound;
}

export async function searchForLocalTorrentByCriteria(
	criteria: TorrentLocator,
): Promise<number | null> {
	const { delay, maxDataDepth } = getRuntimeConfig();

	const rawSearchees: Searchee[] = [];
	if (criteria.infoHash || !criteria.path) {
		const res = createSearcheeFromMetafile(
			await getTorrentByCriteria(criteria),
		);
		if (res.isOk()) rawSearchees.push(res.unwrap());
	} else {
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map(
				createSearcheeFromPath,
			),
		);
		rawSearchees.push(
			...searcheeResults.filter(isOk).map((r) => r.unwrap()),
		);
	}
	const searchees: SearcheeWithLabel[] = rawSearchees.map((searchee) => ({
		...searchee,
		label: Label.WEBHOOK,
	}));
	const includeEpisodes = searchees.length === 1;
	const hashesToExclude = await getInfoHashesToExclude();
	let totalFound = 0;
	let filtered = 0;
	const cachedSearch: CachedSearch = { q: null, indexerCandidates: [] };
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			if (!filterByContent(searchee, includeEpisodes)) {
				filtered++;
				continue;
			}
			const sleep = wait(delay * 1000);

			const { matches, searchedIndexers } = await findOnOtherSites(
				searchee,
				hashesToExclude,
				cachedSearch,
				progress,
			);
			totalFound += matches;

			// if all indexers were rate limited, don't sleep
			if (searchedIndexers === 0 || i === searchees.length - 1) continue;
			await sleep;
		} catch (e) {
			const searcheeLog = getLogString(searchee, chalk.bold.white);
			logger.error({
				label: searchee.label,
				message: `${progress}Error searching for ${searcheeLog}`,
			});
			logger.debug(e);
		}
	}
	if (filtered === searchees.length) return null;
	return totalFound;
}

export async function checkNewCandidateMatch(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}> {
	const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
	const { keys, metas } = await getSimilarTorrentsByName(candidate.name);
	const method = keys.length ? `[${keys}]` : "Fuse fallback";
	if (!metas.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an existing entry using ${method} for ${candidateLog}`,
		});
		return { decision: null, actionResult: null };
	}
	const searchees: SearcheeWithLabel[] = filterDupesFromSimilar(
		metas
			.map(createSearcheeFromMetafile)
			.filter(isOk)
			.map((r) => r.unwrap())
			.map((searchee) => ({ ...searchee, label: searcheeLabel }))
			.filter((searchee) => filterByContent(searchee)),
	);
	if (!searchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `No valid entries found using ${method} for ${candidateLog}`,
		});
		return { decision: null, actionResult: null };
	}
	logger.verbose({
		label: searcheeLabel,
		message: `Unique entries [${searchees.map((m) => m.title)}] using ${method} for ${candidateLog}`,
	});

	const hashesToExclude = await getInfoHashesToExclude();

	let decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null =
		null;
	let actionResult: ActionResult | null = null;
	searchees.sort((a, b) => b.files.length - a.files.length);
	for (const searchee of searchees) {
		await db("searchee")
			.insert({ name: searchee.title })
			.onConflict("name")
			.ignore();

		const assessment: ResultAssessment = await assessCandidateCaching(
			candidate,
			searchee,
			hashesToExclude,
		);

		if (!isAnyMatchedDecision(assessment.decision)) {
			if (assessment.decision === Decision.SAME_INFO_HASH) {
				decision = null;
				break;
			}
			if (
				assessment.decision === Decision.INFO_HASH_ALREADY_EXISTS &&
				(!decision || !isAnyMatchedDecision(decision))
			) {
				decision = assessment.decision;
			}
			continue;
		}
		decision = assessment.decision;

		({ actionResult } = await performAction(
			assessment.metafile!,
			assessment.decision,
			searchee,
			candidate.tracker,
		));
		sendResultsNotification(searchee, [
			[assessment, candidate.tracker, actionResult],
		]);
		if (
			actionResult === SaveResult.SAVED ||
			actionResult === InjectionResult.SUCCESS ||
			actionResult === InjectionResult.ALREADY_EXISTS
		) {
			break;
		}
	}
	return { decision, actionResult };
}

async function findAllSearchees(
	searcheeLabel: SearcheeLabel,
): Promise<SearcheeWithLabel[]> {
	const { torrents, dataDirs, torrentDir } = getRuntimeConfig();
	const rawSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile), // Also create searchee from path
		);
		rawSearchees.push(
			...searcheeResults.filter(isOk).map((r) => r.unwrap()),
		);
	} else {
		if (typeof torrentDir === "string") {
			rawSearchees.push(...(await loadTorrentDirLight(torrentDir)));
		}
		if (Array.isArray(dataDirs)) {
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map(createSearcheeFromPath),
			);
			rawSearchees.push(
				...searcheeResults.filter(isOk).map((r) => r.unwrap()),
			);
		}
	}
	return rawSearchees.map((searchee) => ({
		...searchee,
		label: searcheeLabel,
	}));
}

async function findSearchableTorrents(): Promise<{
	searchees: SearcheeWithLabel[];
	hashesToExclude: string[];
}> {
	const { searchLimit } = getRuntimeConfig();

	const realSearchees = await findAllSearchees(Label.SEARCH);
	const hashesToExclude = realSearchees
		.map((t) => t.infoHash)
		.filter(isTruthy);

	// Group the exact same search queries together for easy cache use later
	const grouping = new Map<string, SearcheeWithLabel[]>();
	for (const searchee of realSearchees.filter((s) => filterByContent(s))) {
		const key = await getSearchString(searchee);
		if (!grouping.has(key)) {
			grouping.set(key, []);
		}
		grouping.get(key)!.push(searchee);
	}
	const keysToDelete: string[] = [];
	for (const [key, groupedSearchees] of grouping) {
		// If one searchee needs to be searched, use the candidates for all
		const filteredSearchees = filterDupesFromSimilar(groupedSearchees);
		const results = await Promise.all(
			filteredSearchees.map(filterTimestamps),
		);
		if (!results.some(isTruthy)) {
			keysToDelete.push(key);
			continue;
		}
		// Prefer infoHash
		filteredSearchees.sort((a, b) => {
			if (a.infoHash && !b.infoHash) return -1;
			if (!a.infoHash && b.infoHash) return 1;
			return 0;
		});
		// Sort by most number files (less chance of partial)
		filteredSearchees.sort((a, b) => {
			return b.files.length - a.files.length;
		});
		grouping.set(key, filteredSearchees);
	}
	for (const key of keysToDelete) {
		grouping.delete(key);
	}
	let finalSearchees = Array.from(grouping.values()).flat();

	logger.info({
		label: Label.SEARCH,
		message: `Found ${realSearchees.length} torrents, ${finalSearchees.length} suitable to search for matches using ${grouping.size} unique queries`,
	});

	if (searchLimit && finalSearchees.length > searchLimit) {
		logger.info({
			label: Label.SEARCH,
			message: `Limited to ${searchLimit} searches`,
		});
		finalSearchees = finalSearchees.slice(0, searchLimit);
	}

	return { searchees: finalSearchees, hashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { searchees, hashesToExclude } = await findSearchableTorrents();

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	if (linkDir && !fs.existsSync(linkDir)) {
		fs.mkdirSync(linkDir, { recursive: true });
	}

	const totalFound = await findMatchesBatch(searchees, hashesToExclude);

	logger.info({
		label: Label.SEARCH,
		message: chalk.cyan(
			`Found ${chalk.bold.white(
				totalFound,
			)} cross seeds from ${chalk.bold.white(
				searchees.length,
			)} original torrents`,
		),
	});
}

export async function scanRssFeeds() {
	const { torznab } = getRuntimeConfig();
	if (torznab.length > 0) {
		const candidates = await queryRssFeeds();
		const lastRun =
			(
				await db("job_log")
					.select("last_run")
					.where({ name: "rss" })
					.first()
			)?.last_run ?? 0;
		const candidatesSinceLastTime = candidates.filter(
			(c) => c.pubDate > lastRun,
		);
		logger.verbose({
			label: Label.RSS,
			message: `Scan returned ${
				candidatesSinceLastTime.length
			} new results, ignoring ${
				candidates.length - candidatesSinceLastTime.length
			} already seen`,
		});
		logger.verbose({
			label: Label.RSS,
			message: "Indexing new torrents...",
		});
		await indexNewTorrents();
		for (const [i, candidate] of candidatesSinceLastTime.entries()) {
			const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
			logger.verbose({
				label: Label.RSS,
				message: `(${i + 1}/${candidatesSinceLastTime.length}) ${candidateLog}`,
			});
			await checkNewCandidateMatch(candidate, Label.RSS);
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}

async function injectDecideStage(
	meta: Metafile,
	searchees: SearcheeWithLabel[],
): Promise<{
	fullMatches: FullMatches;
	partialMatches: PartialMatches;
	foundBlocked: boolean;
}> {
	const fullMatches: [
		SearcheeWithLabel,
		Decision.MATCH | Decision.MATCH_SIZE_ONLY,
	][] = [];
	const partialMatches: [SearcheeWithLabel, Decision.MATCH_PARTIAL][] = [];
	let foundBlocked = false;
	for (const searchee of searchees) {
		const { decision } = await assessCandidate(meta, searchee, []);
		if (!isAnyMatchedDecision(decision)) {
			if (decision === Decision.BLOCKED_RELEASE) {
				foundBlocked = true;
			}
			continue;
		}

		// If name or file names are not similar consider it a false positive
		if (
			!areMediaTitlesSimilar(searchee.title, meta.title) &&
			!areMediaTitlesSimilar(searchee.title, meta.name) &&
			!areMediaTitlesSimilar(searchee.name, meta.name) &&
			!areMediaTitlesSimilar(searchee.name, meta.title) &&
			!meta.files.some((metaFile) =>
				searchee.files.some((searcheeFile) =>
					areMediaTitlesSimilar(searcheeFile.name, metaFile.name),
				),
			)
		) {
			logger.warn({
				label: Label.INJECT,
				message: `Skipping potential false positive for ${getLogString(meta, chalk.bold.white)} from ${getLogString(searchee, chalk.bold.white)}`,
			});
			continue;
		}

		if (decision === Decision.MATCH) {
			fullMatches.unshift([searchee, decision]);
		} else if (decision === Decision.MATCH_SIZE_ONLY) {
			fullMatches.push([searchee, decision]);
		} else {
			partialMatches.push([searchee, decision]);
		}
	}
	fullMatches.sort(([searcheeA], [searcheeB]) => {
		// Prefer torrent over data/virtual, only torrent knows if it's complete
		if (searcheeA.infoHash && !searcheeB.infoHash) {
			return -1;
		}
		if (!searcheeA.infoHash && searcheeB.infoHash) {
			return 1;
		}
		return 0; // Should keep MATCH first within a searchee type
	});
	partialMatches.sort(([searcheeA], [searcheeB]) => {
		// Prefer torrent/data over virtual, partials are always rechecked
		if (
			(searcheeA.infoHash || searcheeA.path) &&
			!(searcheeB.infoHash || searcheeB.path)
		) {
			return -1;
		}
		if (
			!(searcheeA.infoHash || searcheeA.path) &&
			(searcheeB.infoHash || searcheeB.path)
		) {
			return 1;
		}
		return searcheeB.files.length - searcheeA.files.length; // Prefer more files
	});
	return { fullMatches, partialMatches, foundBlocked };
}

async function injectInitialAction(
	meta: Metafile,
	fullMatches: FullMatches,
	partialMatches: PartialMatches,
	tracker: string,
): Promise<{
	injectionResult: InjectionResult;
	matchedSearchee?: SearcheeWithLabel;
	matchedDecision?: DecisionAnyMatch;
	linkedNewFiles: boolean;
}> {
	let injectionResult = InjectionResult.FAILURE;
	let matchedSearchee: SearcheeWithLabel | undefined;
	let matchedDecision: DecisionAnyMatch | undefined;
	let linkedNewFiles = false;
	for (const [searchee, decision] of [...fullMatches, ...partialMatches]) {
		if (
			injectionResult === InjectionResult.TORRENT_NOT_COMPLETE &&
			!searchee.infoHash
		) {
			continue; // Data/virtual searchee doesn't know if torrent is complete
		}
		const res = await performAction(meta, decision, searchee, tracker);
		const result = res.actionResult;
		if (res.linkedNewFiles) {
			linkedNewFiles = true;
		}
		if (
			injectionResult === InjectionResult.SUCCESS ||
			result === InjectionResult.FAILURE ||
			result === SaveResult.SAVED
		) {
			continue;
		}
		if (result === InjectionResult.ALREADY_EXISTS) {
			injectionResult = result;
			continue;
		}
		if (result === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (injectionResult !== InjectionResult.ALREADY_EXISTS) {
				injectionResult = result;
				matchedSearchee = searchee;
				matchedDecision = decision;
			}
			continue;
		}
		injectionResult = InjectionResult.SUCCESS;
		matchedSearchee = searchee;
		matchedDecision = decision;
	}
	return {
		injectionResult,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
	};
}

async function injectFromStalledTorrent(
	meta: Metafile,
	fullMatches: FullMatches,
	partialMatches: PartialMatches,
	tracker: string,
	injectionResult: InjectionResult,
	progress: string,
	filePathLog: string,
): Promise<boolean> {
	let linkedNewFiles = false;
	let inClient = (await getClient().isTorrentComplete(meta.infoHash)).isOk();
	let injected = false;
	for (const [searchee, decision] of [...fullMatches, ...partialMatches]) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			meta,
			tracker,
			decision,
			{ onlyCompleted: false },
		);
		const linkResult = linkedFilesRootResult.isOk()
			? linkedFilesRootResult.unwrap()
			: null;
		if (linkResult && linkResult.linkedNewFiles) {
			linkedNewFiles = true;
		}
		if (!inClient) {
			if (linkedFilesRootResult.isOk()) {
				const destinationDir = dirname(linkResult!.contentPath);
				const result = await getClient().inject(
					meta,
					searchee,
					Decision.MATCH_PARTIAL, // Should always be considered partial
					destinationDir,
				);
				// result is only SUCCESS or FAILURE here but still log original injectionResult
				if (result === InjectionResult.SUCCESS) {
					logger.info({
						label: Label.INJECT,
						message: `${progress} Injected ${filePathLog} using stalled source, you will need to resume or remove from client - ${chalk.green(injectionResult)}`,
					});
					inClient = true;
					injected = true;
				} else {
					logger.warn({
						label: Label.INJECT,
						message: `${progress} Failed to inject ${filePathLog} using stalled source - ${chalk.yellow(injectionResult)}`,
					});
				}
			} else {
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Failed to link files for ${filePathLog}, ${linkedFilesRootResult.unwrapErr()} - ${chalk.yellow(injectionResult)}`,
				});
			}
		}
	}
	if (inClient && !injected) {
		if (linkedNewFiles) {
			logger.info({
				label: Label.INJECT,
				message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
			});
			await getClient().recheckTorrent(meta.infoHash);
		} else {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} No new files linked for ${filePathLog}, resume or remove from client - ${chalk.yellow(injectionResult)}`,
			});
		}
	}
	return injected;
}

function injectSummary(summary: InjectSummary): void {
	const incompleteMsg = `${chalk.bold.yellow(summary.ALREADY_EXISTS)} existed in client${
		summary.INCOMPLETE_CANDIDATES
			? chalk.dim(` (${summary.INCOMPLETE_CANDIDATES} were incomplete)`)
			: ""
	}`;
	const resultMsg = formatAsList(
		[
			`Injected ${chalk.bold.green(summary.INJECTED)}/${chalk.bold.white(summary.TOTAL)} torrents`,
			summary.FULL_MATCHES &&
				`${chalk.bold.green(summary.FULL_MATCHES)} were full matches`,
			summary.PARTIAL_MATCHES &&
				`${chalk.bold.yellow(summary.PARTIAL_MATCHES)} were partial matches`,
			summary.INCOMPLETE_SEARCHEES &&
				`${chalk.bold.yellow(summary.INCOMPLETE_SEARCHEES)} had incomplete sources`,
			summary.ALREADY_EXISTS && incompleteMsg,
			summary.BLOCKED &&
				`${chalk.bold.yellow(summary.BLOCKED)} were possibly blocklisted`,
			summary.FAILED &&
				`${chalk.bold.red(summary.FAILED)} failed to inject`,
			summary.UNMATCHED &&
				`${chalk.bold.red(summary.UNMATCHED)} had no matches`,
		].filter(isTruthy),
		{ sort: false, type: "unit" },
	);
	logger.info({ label: Label.INJECT, message: chalk.cyan(resultMsg) });

	if (summary.UNMATCHED > 0) {
		logger.info({
			label: Label.INJECT,
			message: `Use "${chalk.bold.white("cross-seed diff")}" to get the reasons two torrents are not considered matches`,
		});
	}

	if (summary.FOUND_BAD_FORMAT && !summary.FLAT_LINKING) {
		logger.warn({
			label: Label.INJECT,
			message: `Some torrents could be linked to linkDir/${UNKNOWN_TRACKER} - follow .torrent naming format in the docs to avoid this`,
		});
	}
}

export async function injectSavedTorrents() {
	const { flatLinking, injectDir, linkDir, outputDir } = getRuntimeConfig();
	const targetDir = injectDir ?? outputDir;
	const targetDirLog = chalk.bold.magenta(targetDir);

	const dirContents = await findAllTorrentFilesInDir(targetDir);
	if (dirContents.length === 0) {
		logger.info({
			label: Label.INJECT,
			message: `No torrent files found to inject in ${targetDirLog}`,
		});
		return;
	}
	logger.info({
		label: Label.INJECT,
		message: `Found ${chalk.bold.white(dirContents.length)} torrent file(s) to inject in ${targetDirLog}`,
	});

	const searchees = await findAllSearchees(Label.INJECT);

	const toDelete = new Set<string>();

	// Usually source got deleted or partial injection never completes
	function shouldCleanUpTorrent(torrentFilePath: string) {
		return fs.statSync(torrentFilePath).mtimeMs < Date.now() - ms("1 week");
	}
	function getTorrentFilePathLog(torrentFilePath: string) {
		return chalk.bold.magenta(
			torrentFilePath.replace(
				/\[([a-z0-9]{40})].torrent$/i,
				(match, hash) => match.replace(hash, sanitizeInfoHash(hash)),
			),
		);
	}

	const summary: InjectSummary = {
		TOTAL: dirContents.length,
		INJECTED: 0,
		FULL_MATCHES: 0,
		PARTIAL_MATCHES: 0,
		BLOCKED: 0,
		ALREADY_EXISTS: 0,
		INCOMPLETE_CANDIDATES: 0,
		INCOMPLETE_SEARCHEES: 0,
		FAILED: 0,
		UNMATCHED: 0,
		FOUND_BAD_FORMAT: false,
		FLAT_LINKING: flatLinking,
	};
	let count = 0;
	for (const torrentFilePath of dirContents) {
		const progress = chalk.blue(`(${++count}/${dirContents.length})`);
		const filePathLog = getTorrentFilePathLog(torrentFilePath);
		if (shouldCleanUpTorrent(torrentFilePath)) {
			toDelete.add(torrentFilePath);
		}
		let meta: Metafile;
		try {
			meta = await parseTorrentFromFilename(torrentFilePath);
		} catch (e) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to parse ${filePathLog}`,
			});
			logger.debug(e);
			continue;
		}
		const metaLog = getLogString(meta, chalk.bold.white);

		const torrentNameInfo =
			await parseInfoFromSavedTorrent(torrentFilePath);
		const tracker = torrentNameInfo?.tracker ?? UNKNOWN_TRACKER;
		if (tracker === UNKNOWN_TRACKER) {
			summary.FOUND_BAD_FORMAT = true;
		}

		const { fullMatches, partialMatches, foundBlocked } =
			await injectDecideStage(meta, searchees);
		if (fullMatches.length === 0 && partialMatches.length === 0) {
			if (foundBlocked) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.yellow("possibly blocklisted")}: ${filePathLog}`,
				});
				summary.BLOCKED++;
			} else {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.red("has no matches")}: ${filePathLog}`,
				});
				summary.UNMATCHED++;
			}
			continue;
		}

		const {
			injectionResult,
			matchedSearchee,
			matchedDecision,
			linkedNewFiles,
		} = await injectInitialAction(
			meta,
			fullMatches,
			partialMatches,
			tracker,
		);
		if (injectionResult === InjectionResult.FAILURE) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to inject ${filePathLog} - ${chalk.red(injectionResult)}`,
			});
			summary.FAILED++;
			toDelete.delete(torrentFilePath);
			continue;
		}
		if (injectionResult === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (
				!linkDir ||
				fs.statSync(torrentFilePath).mtimeMs >= Date.now() - ms("1 day")
			) {
				// Normal case where source is likely still downloading
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}`,
				});
			} else {
				// Since source is stalled, add to client paused so user can resume later if desired
				// Try linking all possible matches as they may have different files
				await injectFromStalledTorrent(
					meta,
					fullMatches,
					partialMatches,
					tracker,
					injectionResult,
					progress,
					filePathLog,
				);
			}
			summary.INCOMPLETE_SEARCHEES++;
			continue;
		}
		const result = await getClient().isTorrentComplete(meta.infoHash);
		let isComplete = result.isOk() ? result.unwrap() : false;
		if (isComplete) {
			toDelete.add(torrentFilePath);
		}
		if (injectionResult === InjectionResult.ALREADY_EXISTS) {
			if (linkedNewFiles) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
				});
				await getClient().recheckTorrent(meta.infoHash);
			} else if (fullMatches.length && !isComplete) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} Rechecking ${filePathLog} as it's not complete but has all files - ${chalk.green(injectionResult)}`,
				});
				isComplete = true;
				await getClient().recheckTorrent(meta.infoHash);
				toDelete.add(torrentFilePath); // Prevent infinite recheck in rare case of corrupted cross seed
			} else {
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}${isComplete ? "" : " (incomplete)"}`,
				});
			}
			summary.ALREADY_EXISTS++;
			summary.INCOMPLETE_CANDIDATES += isComplete ? 0 : 1;
			continue;
		}
		logger.info({
			label: Label.INJECT,
			message: `${progress} Injected ${filePathLog} - ${chalk.green(injectionResult)}`,
		});
		sendResultsNotification(matchedSearchee!, [
			[
				{ decision: matchedDecision!, metafile: meta },
				tracker,
				injectionResult,
			],
		]);
		summary.INJECTED++;
		if (matchedDecision! === Decision.MATCH_PARTIAL) {
			summary.PARTIAL_MATCHES++;
		} else {
			summary.FULL_MATCHES++;
		}
	}

	for (const torrentFilePath of toDelete) {
		const filePathLog = getTorrentFilePathLog(torrentFilePath);
		try {
			if (shouldCleanUpTorrent(torrentFilePath)) {
				logger.warn({
					label: Label.INJECT,
					message: `Deleting ${filePathLog} as it has failed to inject for too long`,
				});
			} else {
				logger.info({
					label: Label.INJECT,
					message: `Deleting ${filePathLog} as it's in client and complete`,
				});
			}
			fs.unlinkSync(torrentFilePath);
		} catch (e) {
			logger.error({
				label: Label.INJECT,
				message: `Failed to delete ${filePathLog}`,
			});
			logger.debug(e);
		}
	}

	injectSummary(summary);
}
