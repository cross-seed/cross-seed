import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import { performAction, performActions } from "./action.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	isAnyMatchedDecision,
	SaveResult,
} from "./constants.js";
import {
	findPotentialNestedRoots,
	findSearcheesFromAllDataDirs,
} from "./dataFiles.js";
import { db } from "./db.js";
import { assessCandidateCaching, ResultAssessment } from "./decide.js";
import {
	getEnabledIndexers,
	Indexer,
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
	getInfoHashesToExclude,
	getSimilarTorrentsByName,
	getTorrentByCriteria,
	indexNewTorrents,
	loadTorrentDirLight,
	TorrentLocator,
} from "./torrent.js";
import {
	CachedSearch,
	getSearchString,
	queryRssFeeds,
	searchTorznab,
} from "./torznab.js";
import { getLogString, humanReadableDate, isTruthy, wait } from "./utils.js";

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

export async function findAllSearchees(
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

/**
 * Exclude indexers that don't support pagination
 * only comparing indexers own time against itself.
 */
function filterRSSCandidates(
	indexerId: number,
	candidates: Candidate[],
	page: number,
	indexersToUse: Indexer[],
	excludeIndexerIds: Set<number>,
	oldestPerIndexer: Map<number, number>,
	indexerParams: Map<number, { limit: number; offset: number }>,
): CandidateWithIndexerId[] {
	const prevOldest = oldestPerIndexer.get(indexerId) ?? Infinity;
	const pagedCandidates = candidates.filter(
		({ pubDate }) => pubDate < prevOldest,
	);
	const indexerUrl =
		indexersToUse.find((i) => i.id === indexerId)?.url ??
		indexerId.toString();
	if (pagedCandidates.length) {
		if (page > 1) {
			logger.verbose({
				label: Label.RSS,
				message: `Indexer ${indexerUrl} returned ${pagedCandidates.length} new results for page #${page}`,
			});
		}
		oldestPerIndexer.set(
			indexerId,
			pagedCandidates.reduce(
				(acc, cur) => Math.min(acc, cur.pubDate),
				Infinity,
			),
		);
	} else {
		logger.verbose({
			label: Label.RSS,
			message: `Indexer ${indexerUrl} returned no new results for page #${page}, no longer paging`,
		});
		excludeIndexerIds.add(indexerId);
	}
	const limit = candidates.length; // Override limit with what was actually returned
	const offset = (indexerParams.get(indexerId)?.offset ?? 0) + limit;
	indexerParams.set(indexerId, { limit, offset }); // For next page
	return candidates.map((candidate) => ({
		...candidate,
		indexerId,
	}));
}

async function parseRSSPage(
	page: number,
	lastRun: number,
	indexersToUse: Indexer[],
	excludeIndexerIds: Set<number>,
	oldestPerIndexer: Map<number, number>,
	indexerParams: Map<number, { limit: number; offset: number }>,
): Promise<void> {
	const indexerCandidates = await queryRssFeeds(indexersToUse, indexerParams);
	const totalCandidates = indexerCandidates.reduce(
		(acc, { candidates }) => acc + candidates.length,
		0,
	);
	const candidatesSinceLastTime: Candidate[] = indexerCandidates
		.flatMap(({ indexerId, candidates }) =>
			filterRSSCandidates(
				indexerId,
				candidates,
				page,
				indexersToUse,
				excludeIndexerIds,
				oldestPerIndexer,
				indexerParams,
			),
		)
		.filter(({ indexerId, pubDate }) => {
			if (pubDate < lastRun) {
				excludeIndexerIds.add(indexerId);
				return false;
			}
			return true;
		})
		.sort((a, b) => a.pubDate - b.pubDate);
	logger.verbose({
		label: Label.RSS,
		message: `Scan returned ${
			candidatesSinceLastTime.length
		} new results, ignoring ${
			totalCandidates - candidatesSinceLastTime.length
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
			message: `(Page #${page}: ${i + 1}/${candidatesSinceLastTime.length}) ${humanReadableDate(candidate.pubDate)} - ${candidateLog}`,
		});
		await checkNewCandidateMatch(candidate, Label.RSS);
	}
}

export async function scanRssFeeds() {
	const { rssCadence, torznab } = getRuntimeConfig();
	if (torznab.length > 0) {
		const lastRun =
			(
				await db("job_log")
					.select("last_run")
					.where({ name: "rss" })
					.first()
			)?.last_run ?? 0;
		const pageLimit =
			rssCadence && Date.now() - lastRun > rssCadence + ms("1 minute")
				? 12
				: 1;
		const excludeIndexerIds: Set<number> = new Set();
		const oldestPerIndexer: Map<number, number> = new Map();
		const indexerParams: Map<number, { limit: number; offset: number }> =
			new Map();
		let indexersToUse: Indexer[] = [];
		let prevSearchTime = 0;
		for (let page = 1; page <= pageLimit; page++) {
			const sleepTime = ms("5 minutes") - (Date.now() - prevSearchTime);
			if (page > 1) {
				logger.verbose({
					label: Label.RSS,
					message: `Getting page #${page} of RSS feeds ${sleepTime > 0 ? `in ${Math.round(sleepTime / 1000)}s` : "now"} (paging until #${pageLimit} or pubDate ${humanReadableDate(lastRun)})`,
				});
			}
			if (sleepTime > 0) {
				await wait(sleepTime);
			}
			const searchTime = Date.now();
			indexersToUse = (await getEnabledIndexers()).filter(
				(indexer) => !excludeIndexerIds.has(indexer.id),
			);
			if (!indexersToUse.length) break;
			await parseRSSPage(
				page,
				lastRun,
				indexersToUse,
				excludeIndexerIds,
				oldestPerIndexer,
				indexerParams,
			);
			if (indexersToUse.every((i) => excludeIndexerIds.has(i.id))) break;
			prevSearchTime = searchTime;
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}
