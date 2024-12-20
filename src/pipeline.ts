import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import { performAction, performActions } from "./action.js";
import { getClient } from "./clients/TorrentClient.js";
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
import { db, memDB } from "./db.js";
import {
	assessCandidateCaching,
	getGuidInfoHashMap,
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
	createEnsembleSearchees,
	createSearcheeFromMetafile,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	getNewestFileAge,
	getSeasonKey,
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
import {
	comparing,
	formatAsList,
	getLogString,
	humanReadableDate,
	humanReadableSize,
	isTruthy,
	stripExtension,
	wait,
} from "./utils.js";

export interface Candidate {
	name: string;
	guid: string;
	link: string;
	tracker: string;
	size?: number;
	pubDate?: number;
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
	infoHashesToExclude: Set<string>,
): Promise<AssessmentWithTracker[]> {
	const assessments: AssessmentWithTracker[] = [];
	const guidInfoHashMap = await getGuidInfoHashMap();
	for (const result of candidates) {
		const assessment = await assessCandidateCaching(
			result,
			searchee,
			infoHashesToExclude,
			guidInfoHashMap,
		);
		assessments.push({ assessment, tracker: result.tracker });
	}
	return assessments;
}

async function findOnOtherSites(
	searchee: SearcheeWithLabel,
	infoHashesToExclude: Set<string>,
	indexerSearchCount: Map<number, number>,
	cachedSearch: CachedSearch,
	progress: string,
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.title })
		.onConflict("name")
		.ignore();

	const response = await searchTorznab(
		searchee,
		indexerSearchCount,
		cachedSearch,
		progress,
	);
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
		infoHashesToExclude,
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
	infoHashesToExclude: Set<string>,
) {
	const { delay, searchLimit } = getRuntimeConfig();

	const indexerSearchCount = new Map<number, number>();
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
				infoHashesToExclude,
				indexerSearchCount,
				cachedSearch,
				progress,
			);
			totalFound += matches;

			if (
				searchLimit &&
				indexerSearchCount.size &&
				Array.from(indexerSearchCount.values()).every(
					(n) => n >= searchLimit,
				)
			) {
				logger.info({
					label: searchee.label,
					message: `Reached searchLimit of ${searchLimit} on all indexers`,
				});
				break;
			}

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
	const { delay, maxDataDepth, searchLimit } = getRuntimeConfig();

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
	const infoHashesToExclude = await getInfoHashesToExclude();
	const indexerSearchCount = new Map<number, number>();
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
				infoHashesToExclude,
				indexerSearchCount,
				cachedSearch,
				progress,
			);
			totalFound += matches;

			if (
				searchLimit &&
				indexerSearchCount.size &&
				Array.from(indexerSearchCount.values()).every(
					(n) => n >= searchLimit,
				)
			) {
				logger.info({
					label: searchee.label,
					message: `Reached searchLimit of ${searchLimit} on all indexers`,
				});
				break;
			}

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

async function pushSearcheesForCandidate(
	candidate: Candidate,
	searchees: SearcheeWithLabel[],
	searcheeLabel: SearcheeLabel,
): Promise<string | null> {
	const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
	const { keys, metas } = await getSimilarTorrentsByName(candidate.name);
	const method = keys.length ? `[${keys}]` : "Fuse fallback";
	if (!metas.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an existing entry using ${method} for ${candidateLog}`,
		});
		return null;
	}
	searchees.push(
		...filterDupesFromSimilar(
			metas
				.map(createSearcheeFromMetafile)
				.filter(isOk)
				.map((r) => r.unwrap())
				.map((searchee) => ({ ...searchee, label: searcheeLabel }))
				.filter((searchee) => filterByContent(searchee)),
		),
	);
	if (!searchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `No valid entries found using ${method} for ${candidateLog}`,
		});
		return null;
	}
	return method;
}

async function pushEnsembleForCandidate(
	candidate: Candidate,
	searchees: SearcheeWithLabel[],
	searcheeLabel: SearcheeLabel,
): Promise<string | null> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	if (!seasonFromEpisodes) return null;
	const seasonKey = getSeasonKey(stripExtension(candidate.name));
	if (!seasonKey) return null;

	const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
	const { ensembleTitle, keyTitle, season } = seasonKey;
	const key = `${keyTitle}.${season}`;
	const ensemble = await memDB("ensemble").where({ ensemble: key });
	if (ensemble.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an ensemble ${ensembleTitle} for ${candidateLog}`,
		});
		return null;
	}
	const files = ensemble
		.map((e) => ({
			path: e.absolute_path,
			name: e.name,
			length: e.length,
		}))
		.filter((f) => fs.existsSync(f.path));
	if (files.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find any files for ensemble ${ensembleTitle} for ${candidateLog}: sources may be incomplete or missing`,
		});
		return null;
	}
	// Get searchee.length by total size of each episode (average if multiple files for episode)
	const uniqueElements = new Set(ensemble.map((e) => e.element));
	const totalLength = Math.round(
		[...uniqueElements].reduce((acc, cur) => {
			const elements = ensemble.filter(
				(e) =>
					e.element === cur &&
					files.some((f) => f.path === e.absolute_path),
			);
			const avg =
				elements.reduce((a, c) => a + c.length, 0) / elements.length;
			return acc + avg;
		}, 0),
	);
	searchees.push({
		name: ensembleTitle,
		title: ensembleTitle,
		files: files,
		length: totalLength,
		mtimeMs: await getNewestFileAge(files.map((f) => f.path)),
		label: searcheeLabel,
	});
	logger.verbose({
		label: searcheeLabel,
		message: `Using ensemble ${ensembleTitle} for ${candidateLog}: ${humanReadableSize(totalLength)} - ${files.length} files`,
	});
	return "ensemble";
}

export async function checkNewCandidateMatch(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}> {
	const searchees: SearcheeWithLabel[] = [];

	const methods = [
		await pushSearcheesForCandidate(candidate, searchees, searcheeLabel),
		await pushEnsembleForCandidate(candidate, searchees, searcheeLabel),
	].filter(isTruthy);
	if (!searchees.length) return { decision: null, actionResult: null };
	logger.verbose({
		label: searcheeLabel,
		message: `Unique entries [${searchees.map((m) => m.title)}] using ${formatAsList(methods, { sort: true })} for ${chalk.bold.white(candidate.name)} from ${candidate.tracker}`,
	});
	const infoHashesToExclude = await getInfoHashesToExclude();

	let decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null =
		null;
	let actionResult: ActionResult | null = null;
	searchees.sort(
		comparing(
			(searchee) => !searchee.infoHash, // Prefer packs over ensemble
			(searchee) => -searchee.files.length,
		),
	);
	const guidInfoHashMap = await getGuidInfoHashMap();
	for (const searchee of searchees) {
		await db("searchee")
			.insert({ name: searchee.title })
			.onConflict("name")
			.ignore();

		const assessment: ResultAssessment = await assessCandidateCaching(
			candidate,
			searchee,
			infoHashesToExclude,
			guidInfoHashMap,
		);

		if (
			assessment.decision === Decision.INFO_HASH_ALREADY_EXISTS &&
			!decision
		) {
			decision = assessment.decision;
			break; // In client before rss/announce
		}
		if (!isAnyMatchedDecision(assessment.decision)) {
			continue; // Will report 200 if SAME_INFO_HASH and INFO_HASH_ALREADY_EXISTS
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
			actionResult === InjectionResult.SUCCESS ||
			actionResult === SaveResult.SAVED
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
		const torrentInfos = (await getClient()?.getAllTorrents()) ?? [];
		const searcheeResults = await Promise.all(
			torrents.map((torrent) =>
				createSearcheeFromTorrentFile(torrent, torrentInfos),
			),
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
	infoHashesToExclude: Set<string>;
}> {
	const { searchLimit } = getRuntimeConfig();

	const realSearchees = await findAllSearchees(Label.SEARCH);
	const ensembleSearchees = await createEnsembleSearchees(realSearchees, {
		useFilters: true,
	});
	const infoHashesToExclude = new Set(
		realSearchees.map((t) => t.infoHash).filter(isTruthy),
	);

	// Group the exact same search queries together for easy cache use later
	const grouping = new Map<string, SearcheeWithLabel[]>();
	const validSearchees = [
		...ensembleSearchees,
		...realSearchees.filter((searchee) => filterByContent(searchee)),
	];
	for (const searchee of validSearchees) {
		const key = await getSearchString(searchee);
		if (!grouping.has(key)) {
			grouping.set(key, []);
		}
		grouping.get(key)!.push(searchee);
	}
	for (const [key, groupedSearchees] of grouping) {
		// If one searchee needs to be searched, use the candidates for all
		const filteredSearchees = filterDupesFromSimilar(groupedSearchees);
		const results = await Promise.all(
			filteredSearchees.map(filterTimestamps),
		);
		if (!results.some(isTruthy)) {
			grouping.delete(key);
			continue;
		}
		filteredSearchees.sort(
			comparing(
				(searchee) => -searchee.files.length, // Assume searchees are complete
				(searchee) => !searchee.infoHash,
			),
		);
		grouping.set(key, filteredSearchees);
	}
	const finalSearchees = Array.from(grouping.values()).flat();

	logger.info({
		label: Label.SEARCH,
		message: `Found ${realSearchees.length + ensembleSearchees.length} torrents, ${finalSearchees.length} suitable to search for matches using ${grouping.size} unique queries`,
	});

	if (searchLimit && grouping.size > searchLimit) {
		logger.info({
			label: Label.SEARCH,
			message: `Limited to ${searchLimit} searches (unique queries) per indexer`,
		});
	}

	return { searchees: finalSearchees, infoHashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { searchees, infoHashesToExclude } = await findSearchableTorrents();

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	if (linkDir && !fs.existsSync(linkDir)) {
		fs.mkdirSync(linkDir, { recursive: true });
	}

	const totalFound = await findMatchesBatch(searchees, infoHashesToExclude);

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
	const { torrentDir, torznab } = getRuntimeConfig();
	if (!torrentDir || !torznab.length) {
		logger.error({
			label: Label.RSS,
			message: "RSS requires torrentDir and torznab to be set",
		});
		return;
	}
	const lastRun: number =
		(await db("job_log").select("last_run").where({ name: "rss" }).first())
			?.last_run ?? 0;
	logger.verbose({
		label: Label.RSS,
		message: "Indexing new torrents...",
	});
	await indexNewTorrents();
	logger.verbose({
		label: Label.RSS,
		message: "Querying RSS feeds...",
	});
	const candidates = queryRssFeeds(lastRun);
	let i = 0;
	for await (const candidate of candidates) {
		await checkNewCandidateMatch(candidate, Label.RSS);
		i++;
	}

	logger.info({
		label: Label.RSS,
		message: `RSS scan complete - checked ${i} new candidates since ${humanReadableDate(lastRun)}`,
	});
}
