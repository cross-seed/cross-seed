import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import { basename } from "path";
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
import { getJobLastRun, JobName } from "./jobs.js";
import { Label, logger } from "./logger.js";
import {
	filterByContent,
	filterDupesFromSimilar,
	filterTimestamps,
} from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { isOk } from "./Result.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import {
	createEnsembleSearchees,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	File,
	getNewestFileAge,
	getSeasonKeys,
	Searchee,
	SearcheeLabel,
	SearcheeWithLabel,
} from "./searchee.js";
import {
	getInfoHashesToExclude,
	getSimilarByName,
	getTorrentByCriteria,
	indexTorrentsAndDataDirs,
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
	inBatches,
	isTruthy,
	Mutex,
	stripExtension,
	wait,
	withMutex,
	WithRequired,
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

export type CandidateWithIndexerId = WithRequired<Candidate, "indexerId">;

export interface AssessmentWithTracker {
	assessment: ResultAssessment;
	tracker: string;
}

interface FoundOnOtherSites {
	searchedIndexers: number;
	matches: number;
}

async function assessCandidates(
	candidates: CandidateWithIndexerId[],
	searchee: SearcheeWithLabel,
	infoHashesToExclude: Set<string>,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<AssessmentWithTracker[]> {
	const guidInfoHashMap = await getGuidInfoHashMap();
	const candidatesByIndexer = candidates.reduce((acc, cur) => {
		if (!acc.has(cur.indexerId)) acc.set(cur.indexerId, []);
		acc.get(cur.indexerId)!.push(cur);
		return acc;
	}, new Map<number, CandidateWithIndexerId[]>());
	return Promise.all(
		Array.from(candidatesByIndexer.values()).map(async (candidates) => {
			const assessments: AssessmentWithTracker[] = [];
			for (const candidate of candidates) {
				assessments.push({
					assessment: await assessCandidateCaching(
						candidate,
						searchee,
						infoHashesToExclude,
						guidInfoHashMap,
						options,
					),
					tracker: candidate.tracker,
				});
			}
			return assessments;
		}),
	).then((assessments) => assessments.flat());
}

async function findOnOtherSites(
	searchee: SearcheeWithLabel,
	infoHashesToExclude: Set<string>,
	indexerSearchCount: Map<number, number>,
	cachedSearch: CachedSearch,
	progress: string,
	options?: { configOverride: Partial<RuntimeConfig> },
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
		options,
	);
	const cachedIndexers = cachedSearch.indexerCandidates.length;
	const searchedIndexers = response.length - cachedIndexers;
	cachedSearch.indexerCandidates = response;

	const candidates: CandidateWithIndexerId[] = response.flatMap((e) =>
		e.candidates.map((candidate) => ({
			...candidate,
			indexerId: e.indexerId,
		})),
	);

	if (response.length) {
		logger.verbose({
			label: Label.DECIDE,
			message: `Assessing ${candidates.length} candidates for ${searchee.title} from ${searchedIndexers}|${cachedIndexers} indexers by search|cache`,
		});
	}
	const assessments = await assessCandidates(
		candidates,
		searchee,
		infoHashesToExclude,
		options,
	);

	const { rateLimited, notRateLimited } = assessments.reduce(
		(acc, cur, idx) => {
			const candidate = candidates[idx];
			if (cur.assessment.decision === Decision.RATE_LIMITED) {
				acc.rateLimited.add(candidate.indexerId);
				acc.notRateLimited.delete(candidate.indexerId);
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
	options?: { configOverride: Partial<RuntimeConfig> },
) {
	const { delay, searchLimit } = getRuntimeConfig(options?.configOverride);

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
				options,
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
				message: `${progress}Error searching for ${searcheeLog}: ${e.message}`,
			});
			logger.debug(e);
		}
	}
	return totalFound;
}

export async function searchForLocalTorrentByCriteria(
	criteria: TorrentLocator,
	options: {
		configOverride: Partial<RuntimeConfig>;
		ignoreCrossSeeds: boolean;
	},
): Promise<number | null> {
	const { delay, maxDataDepth, searchLimit } = getRuntimeConfig();

	const rawSearchees: Searchee[] = [];
	if (!criteria.path) {
		rawSearchees.push(await getTorrentByCriteria(criteria));
	} else {
		const memoizedPaths = new Map<string, string[]>();
		const memoizedLengths = new Map<string, number>();
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map((path) =>
				createSearcheeFromPath(path, memoizedPaths, memoizedLengths),
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
	const allowSeasonPackEpisodes = searchees.length === 1;
	const infoHashesToExclude = await getInfoHashesToExclude();
	const indexerSearchCount = new Map<number, number>();
	let totalFound = 0;
	let filtered = 0;
	const cachedSearch: CachedSearch = { q: null, indexerCandidates: [] };
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			if (
				!filterByContent(searchee, {
					configOverride: options.configOverride,
					allowSeasonPackEpisodes,
					ignoreCrossSeeds: options.ignoreCrossSeeds,
				})
			) {
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
				options,
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
				message: `${progress}Error searching for ${searcheeLog}: ${e.message}`,
			});
			logger.debug(e);
		}
	}
	if (filtered === searchees.length) return null;
	return totalFound;
}

async function getSearcheesForCandidate(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{ searchees: SearcheeWithLabel[]; method: string } | null> {
	const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
	const { keys, clientSearchees, dataSearchees } = await getSimilarByName(
		candidate.name,
	);
	const method = keys.length ? `[${keys}]` : "Fuse fallback";
	if (!clientSearchees.length && !dataSearchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an existing entry using ${method} for ${candidateLog}`,
		});
		return null;
	}
	const searchees = filterDupesFromSimilar(
		[...clientSearchees, ...dataSearchees]
			.map((searchee) => ({ ...searchee, label: searcheeLabel }))
			.filter((searchee) => filterByContent(searchee)),
	);
	if (!searchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `No valid entries found using ${method} for ${candidateLog}`,
		});
		return null;
	}
	return { searchees, method };
}

async function getEnsembleForCandidate(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{ searchees: SearcheeWithLabel[]; method: string } | null> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	if (!seasonFromEpisodes) return null;
	const seasonKeys = getSeasonKeys(stripExtension(candidate.name));
	if (!seasonKeys) return null;
	const method = "ensemble";

	const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
	const { ensembleTitles, keyTitles, season } = seasonKeys;
	const keys = keyTitles.map((keyTitle) => `${keyTitle}.${season}`);
	const ensemble = await memDB("ensemble").whereIn("ensemble", keys);
	if (ensemble.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an ${method} [${ensembleTitles}] for ${candidateLog}`,
		});
		return null;
	}
	const duplicateFiles = new Set<string>();
	const entriesToDelete: string[] = [];
	const files = ensemble.reduce<File[]>((acc, entry) => {
		const path = entry.path;
		if (!fs.existsSync(path)) {
			entriesToDelete.push(path);
			return acc;
		}
		const length = fs.statSync(path).size;
		const name = basename(path);
		const test = `${entry.element}-${length}`;
		if (duplicateFiles.has(test)) return acc; // cross seeded file
		duplicateFiles.add(test);
		acc.push({ length, name, path });
		return acc;
	}, []);
	await inBatches(entriesToDelete, async (batch) => {
		await memDB("data").whereIn("path", batch).del();
		await memDB("ensemble").whereIn("path", batch).del();
	});
	if (files.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find any files for ${method} [${ensembleTitles}] for ${candidateLog}: sources may be incomplete or missing`,
		});
		return null;
	}
	// Get searchee.length by total size of each episode (average if multiple files for episode)
	const uniqueElements = new Set(ensemble.map((e) => e.element));
	const totalLength = Math.round(
		[...uniqueElements].reduce((acc, cur) => {
			const lengths = ensemble.reduce<number[]>((lengths, e) => {
				if (e.element !== cur) return lengths;
				const file = files.find((f) => f.path === e.path);
				if (!file) return lengths; // Was an ignored cross seeded file
				lengths.push(file.length);
				return lengths;
			}, []);
			return acc + lengths.reduce((a, b) => a + b) / lengths.length;
		}, 0),
	);
	const mtimeMs = await getNewestFileAge(files.map((f) => f.path));
	const searchees: SearcheeWithLabel[] = ensembleTitles.map((title) => ({
		name: title,
		title,
		files,
		length: totalLength,
		mtimeMs,
		label: searcheeLabel,
	}));
	logger.verbose({
		label: searcheeLabel,
		message: `Using ${method} [${ensembleTitles}] for ${candidateLog}: ${humanReadableSize(totalLength)} - ${files.length} files`,
	});
	return { searchees, method };
}

export async function checkNewCandidateMatch(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}> {
	const searchees: SearcheeWithLabel[] = [];
	const methods: string[] = [];
	const lookup = await getSearcheesForCandidate(candidate, searcheeLabel);
	if (lookup) {
		searchees.push(...lookup.searchees);
		methods.push(lookup.method);
	}
	const ensemble = await getEnsembleForCandidate(candidate, searcheeLabel);
	if (ensemble) {
		searchees.push(...ensemble.searchees);
		methods.push(ensemble.method);
	}
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
	const { dataDirs, torrentDir, torrents, useClientTorrents } =
		getRuntimeConfig();
	const client = getClient();
	const rawSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const torrentInfos = (await client?.getAllTorrents()) ?? [];
		const searcheeResults = await Promise.all(
			torrents.map((torrent) =>
				createSearcheeFromTorrentFile(torrent, torrentInfos),
			),
		);
		rawSearchees.push(
			...searcheeResults.filter(isOk).map((r) => r.unwrap()),
		);
	} else {
		if (useClientTorrents) {
			const refresh = searcheeLabel === Label.SEARCH ? [] : undefined;
			rawSearchees.push(
				...(await client!.getClientSearchees({ refresh })).searchees,
			);
		} else if (torrentDir) {
			rawSearchees.push(...(await loadTorrentDirLight(torrentDir)));
		}
		if (dataDirs.length) {
			const memoizedPaths = new Map<string, string[]>();
			const memoizedLengths = new Map<string, number>();
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map((path) =>
					createSearcheeFromPath(
						path,
						memoizedPaths,
						memoizedLengths,
					),
				),
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

async function findSearchableTorrents(options?: {
	configOverride: Partial<RuntimeConfig>;
}): Promise<{
	searchees: SearcheeWithLabel[];
	infoHashesToExclude: Set<string>;
}> {
	const { excludeOlder, excludeRecentSearch, searchLimit } = getRuntimeConfig(
		options?.configOverride,
	);

	const { realSearchees, ensembleSearchees } = await withMutex(
		Mutex.CREATE_ALL_SEARCHEES,
		async () => {
			logger.info({
				label: Label.SEARCH,
				message: "Gathering searchees...",
			});
			const realSearchees = await findAllSearchees(Label.SEARCH);
			const ensembleSearchees = await createEnsembleSearchees(
				realSearchees,
				{
					useFilters: true,
				},
			);
			return { realSearchees, ensembleSearchees };
		},
		{ useQueue: true },
	);
	const ignoring = [
		(!excludeOlder || excludeOlder === Number.MAX_SAFE_INTEGER) &&
			"excludeOlder",
		(!excludeRecentSearch || excludeRecentSearch === 1) &&
			"excludeRecentSearch",
	].filter(isTruthy);
	logger.info({
		label: Label.SEARCH,
		message: `Filtering searchees based on config${ignoring.length ? ` (ignoring ${formatAsList(ignoring, { sort: true })})` : ""}...`,
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
			filteredSearchees.map((searchee) =>
				filterTimestamps(searchee, options),
			),
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

export async function bulkSearch(options?: {
	configOverride: Partial<RuntimeConfig>;
}): Promise<void> {
	const { searchees, infoHashesToExclude } =
		await findSearchableTorrents(options);

	const totalFound = await findMatchesBatch(
		searchees,
		infoHashesToExclude,
		options,
	);

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
	const { dataDirs, torrentDir, torznab, useClientTorrents } =
		getRuntimeConfig();
	await indexTorrentsAndDataDirs();
	if (
		!torznab.length ||
		(!useClientTorrents && !torrentDir && !dataDirs.length)
	) {
		logger.error({
			label: Label.RSS,
			message:
				"RSS requires torznab and at least one of useClientTorrents, torrentDir, or dataDirs to be set",
		});
		return;
	}
	logger.verbose({
		label: Label.RSS,
		message: "Querying RSS feeds...",
	});
	const lastRun = (await getJobLastRun(JobName.RSS)) ?? 0;
	const numCandidates = (
		await Promise.all(
			(await queryRssFeeds(lastRun)).map(async (candidates) => {
				let i = 0;
				for await (const candidate of candidates) {
					await checkNewCandidateMatch(candidate, Label.RSS);
					i++;
				}
				return i;
			}),
		)
	).reduce((acc, cur) => acc + cur, 0);

	logger.info({
		label: Label.RSS,
		message: `RSS scan complete - checked ${numCandidates} new candidates since ${humanReadableDate(lastRun)}`,
	});
}
