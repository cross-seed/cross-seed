import chalk from "chalk";
import { stat } from "fs/promises";
// Utility function to replace lodash zip
function zip<T, U, V>(arr1: T[], arr2: U[], arr3: V[]): [T, U, V][] {
	return arr1.map((item, index) => [item, arr2[index], arr3[index]]);
}
import ms from "ms";
import { basename } from "path";
import { performAction, performActions } from "./action.js";
import { byClientHostPriority, getClients } from "./clients/TorrentClient.js";
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
import {
	assessCandidateCaching,
	getGuidInfoHashMap,
	ResultAssessment,
} from "./decide.js";
import {
	getAllIndexers,
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
import { getEnabledIndexers } from "./indexers.js";
import {
	AsyncSemaphore,
	comparing,
	filterAsync,
	flatMapAsync,
	formatAsList,
	getLogString,
	humanReadableDate,
	humanReadableSize,
	inBatches,
	isTruthy,
	mapAsync,
	Mutex,
	notExists,
	reduceAsync,
	stripExtension,
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
	cookie?: string;
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
	return flatMapAsync(
		Array.from(candidatesByIndexer.values()),
		async (candidates) => {
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
		},
	);
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
	const candidates = response.flatMap((e) => e.candidates);

	if (response.length) {
		logger.verbose({
			label: `${searchee.label}/${Label.DECIDE}`,
			message: `Assessing ${candidates.length} candidates for ${searchee.title} from ${searchedIndexers}|${cachedIndexers} indexers by search|cache`,
		});
	}
	const assessments = await assessCandidates(
		candidates,
		searchee,
		infoHashesToExclude,
		options,
	);

	const allIndexers = await getAllIndexers();
	const rateLimitedNames = new Set<string>();
	const { rateLimited, notRateLimited } = assessments.reduce(
		(acc, cur, idx) => {
			const candidate = candidates[idx];
			if (cur.assessment.decision === Decision.RATE_LIMITED) {
				const indexer = allIndexers.find(
					(i) => i.id === candidate.indexerId,
				)!;
				rateLimitedNames.add(indexer.name ?? indexer.url);
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
		rateLimitedNames,
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
	const { searchLimit } = getRuntimeConfig(options?.configOverride);

	const indexerSearchCount = new Map<number, number>();
	let totalFound = 0;
	const cachedSearch: CachedSearch = {
		q: null,
		indexerCandidates: [],
		lastSearch: 0,
	};
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		const prevSearch = cachedSearch.lastSearch;
		try {
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
			if (searchedIndexers === 0) cachedSearch.lastSearch = prevSearch;
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
	const { maxDataDepth, searchLimit } = getRuntimeConfig();

	const rawSearchees: Searchee[] = [];
	if (!criteria.path) {
		rawSearchees.push(...(await getTorrentByCriteria(criteria)));
	} else {
		const memoizedPaths = new Map<string, string[]>();
		const memoizedLengths = new Map<string, number>();
		rawSearchees.push(
			...(
				await mapAsync(
					await findPotentialNestedRoots(criteria.path, maxDataDepth),
					(path) =>
						createSearcheeFromPath(
							path,
							memoizedPaths,
							memoizedLengths,
						),
				)
			)
				.filter(isOk)
				.map((r) => r.unwrap()),
		);
	}
	const searchees: SearcheeWithLabel[] = rawSearchees
		.sort(
			comparing(
				(searchee) => byClientHostPriority(searchee.clientHost),
				(searchee) => -searchee.files.length, // Assume searchees are complete
				(searchee) => !searchee.infoHash,
			),
		)
		.map((searchee) => ({
			...searchee,
			label: Label.WEBHOOK,
		}));
	const allowSeasonPackEpisodes = Array.from(
		searchees
			.reduce((acc, cur) => {
				acc.set(cur.clientHost, (acc.get(cur.clientHost) ?? 0) + 1);
				return acc;
			}, new Map<string | undefined, number>())
			.values(),
	).some((v) => v === 1);
	const infoHashesToExclude = await getInfoHashesToExclude();
	const indexerSearchCount = new Map<number, number>();
	let totalFound = 0;
	let filtered = 0;
	const cachedSearch: CachedSearch = {
		q: null,
		indexerCandidates: [],
		lastSearch: 0,
	};
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		const prevSearch = cachedSearch.lastSearch;
		try {
			if (
				!(await filterByContent(searchee, {
					configOverride: options.configOverride,
					allowSeasonPackEpisodes,
					ignoreCrossSeeds: options.ignoreCrossSeeds,
				}))
			) {
				filtered++;
				continue;
			}
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
			if (searchedIndexers === 0) cachedSearch.lastSearch = prevSearch;
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
	const method = keys.length ? `[${keys}]` : "fuzzy fallback";
	if (!clientSearchees.length && !dataSearchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an existing entry using ${method} for ${candidateLog}`,
		});
		return null;
	}
	const searchees = filterDupesFromSimilar(
		await filterAsync(
			[...clientSearchees, ...dataSearchees].map((searchee) => ({
				...searchee,
				label: searcheeLabel,
			})),
			filterByContent,
		),
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
	const ensemble = await db("ensemble").whereIn("ensemble", keys);
	if (ensemble.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an ${method} [${ensembleTitles}] for ${candidateLog}`,
		});
		return null;
	}
	const duplicateFiles = new Set<string>();
	const entriesToDelete = new Set<string>();
	const hosts = new Map<string, number>();
	const filesWithElement = await reduceAsync<
		{ client_host: string | null; path: string; element: string },
		(File & { element: string })[]
	>(
		ensemble,
		async (acc, entry) => {
			const path = entry.path;
			if (await notExists(path)) {
				entriesToDelete.add(path);
				return acc;
			}
			const length = (await stat(path)).size;
			const name = basename(path);
			const element = entry.element;
			const clientHost = entry.client_host;
			const uniqueKey = `${clientHost}-${element}-${length}`;
			if (duplicateFiles.has(uniqueKey)) return acc; // cross seeded file
			duplicateFiles.add(uniqueKey);
			if (clientHost) {
				hosts.set(clientHost, (hosts.get(clientHost) ?? 0) + 1);
			}
			acc.push({ length, name, path, element });
			return acc;
		},
		[],
	);
	await inBatches(Array.from(entriesToDelete), async (batch) => {
		await db("data").whereIn("path", batch).del();
		await db("ensemble").whereIn("path", batch).del();
	});
	if (filesWithElement.length === 0) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find any files for ${method} [${ensembleTitles}] for ${candidateLog}: sources may be incomplete or missing`,
		});
		return null;
	}
	// Get searchee.length by total size of each episode (average if multiple files for episode)
	const uniqueElements = new Set(filesWithElement.map((f) => f.element));
	const totalLength = Math.round(
		[...uniqueElements].reduce((acc, cur) => {
			const lengths = filesWithElement.reduce<number[]>((lengths, f) => {
				if (f.element === cur) lengths.push(f.length);
				return lengths;
			}, []);
			return acc + lengths.reduce((a, b) => a + b) / lengths.length;
		}, 0),
	);
	const files: File[] = filesWithElement.map(({ element, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
	const mtimeMs = await getNewestFileAge(files.map((f) => f.path));
	const searchees: SearcheeWithLabel[] = ensembleTitles.map((title) => ({
		name: title,
		title,
		files,
		length: totalLength,
		mtimeMs,
		clientHost: [...hosts].sort(
			comparing(
				(host) => -host[1],
				(host) => byClientHostPriority(host[0]),
			),
		)[0]?.[0],
		label: searcheeLabel,
	}));
	logger.verbose({
		label: searcheeLabel,
		message: `Using (${searchees.length}) ${method} [${ensembleTitles}] for ${candidateLog}: ${humanReadableSize(totalLength)} - ${files.length} files`,
	});
	return { searchees, method };
}

const checkNewCandidateMatchSemaphore = new AsyncSemaphore({
	permits: 1,
	lifetimeMs: ms(`1 minute`),
}); // Limit concurrent candidate processing to avoid bogarting the event loop
export async function checkNewCandidateMatch(
	candidate: Candidate,
	searcheeLabel: SearcheeLabel,
): Promise<{
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}> {
	const searchees: SearcheeWithLabel[] = [];
	const methods: string[] = [];
	const semaphoreId = await checkNewCandidateMatchSemaphore.acquire();
	try {
		const lookup = await getSearcheesForCandidate(candidate, searcheeLabel);
		if (lookup) {
			searchees.push(...lookup.searchees);
			methods.push(lookup.method);
		}
		const ensemble = await getEnsembleForCandidate(
			candidate,
			searcheeLabel,
		);
		if (ensemble) {
			searchees.push(...ensemble.searchees);
			methods.push(ensemble.method);
		}
		if (!searchees.length) return { decision: null, actionResult: null };
	} finally {
		checkNewCandidateMatchSemaphore.release(semaphoreId);
	}

	logger.verbose({
		label: searcheeLabel,
		message: `Unique entries (${searchees.length}) [${searchees.map((m) => m.title)}] using ${formatAsList(methods, { sort: true })} for ${chalk.bold.white(candidate.name)} from ${candidate.tracker}`,
	});
	searchees.sort(
		comparing(
			(searchee) => byClientHostPriority(searchee.clientHost),
			(searchee) => !searchee.infoHash, // Prefer packs over ensemble
			(searchee) => -searchee.files.length,
		),
	);
	const infoHashesToExclude = await getInfoHashesToExclude();
	const guidInfoHashMap = await getGuidInfoHashMap();

	let decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null =
		null;
	let actionResult: ActionResult | null = null;
	let matchedSearchee: SearcheeWithLabel | null = null;
	let matchedAssessment: ResultAssessment | null = null;
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
		if (assessment.decision === Decision.INFO_HASH_ALREADY_EXISTS) {
			decision = assessment.decision;
			break; // In client before rss/announce
		}
		if (!isAnyMatchedDecision(assessment.decision)) continue;

		const actionReturn = await performAction(
			assessment.metafile!,
			assessment.decision,
			searchee,
			candidate.tracker,
		);
		if (actionReturn.actionResult === SaveResult.SAVED) {
			decision = assessment.decision;
			actionResult = actionReturn.actionResult;
			matchedSearchee = searchee;
			matchedAssessment = assessment;
			break;
		}
		if (
			assessment.decision !== Decision.MATCH_PARTIAL &&
			(actionReturn.actionResult === InjectionResult.SUCCESS ||
				actionReturn.actionResult === InjectionResult.ALREADY_EXISTS)
		) {
			decision = assessment.decision;
			actionResult = InjectionResult.SUCCESS;
			matchedSearchee = searchee;
			matchedAssessment = assessment;
			break;
		}
		if (actionResult === InjectionResult.SUCCESS) continue;
		if (
			actionResult &&
			actionReturn.actionResult === InjectionResult.FAILURE
		) {
			continue;
		}
		if (
			actionResult === InjectionResult.ALREADY_EXISTS &&
			actionReturn.actionResult === InjectionResult.TORRENT_NOT_COMPLETE
		) {
			continue;
		}
		decision = assessment.decision;
		actionResult = actionReturn.actionResult;
		matchedSearchee = searchee;
		matchedAssessment = assessment;
	}
	if (matchedSearchee) {
		sendResultsNotification(matchedSearchee, [
			[matchedAssessment!, candidate.tracker, actionResult!],
		]);
	}
	if (actionResult === InjectionResult.SUCCESS) {
		void indexTorrentsAndDataDirs();
	}
	return { decision, actionResult };
}

export async function findAllSearchees(
	searcheeLabel: SearcheeLabel,
): Promise<SearcheeWithLabel[]> {
	const { dataDirs, torrentDir, torrents, useClientTorrents } =
		getRuntimeConfig();
	const clients = getClients();
	let rawSearchees: Searchee[] = [];
	await withMutex(
		Mutex.CREATE_ALL_SEARCHEES,
		{ useQueue: true },
		async () => {
			if (Array.isArray(torrents)) {
				const torrentInfos = await flatMapAsync(clients, (client) =>
					client.getAllTorrents(),
				);
				rawSearchees.push(
					...(
						await mapAsync(torrents, (torrent) =>
							createSearcheeFromTorrentFile(
								torrent,
								torrentInfos,
							),
						)
					)
						.filter(isOk)
						.map((r) => r.unwrap()),
				);
			} else {
				if (useClientTorrents) {
					rawSearchees = rawSearchees.concat(
						await flatMapAsync(
							clients,
							async (client) =>
								(
									await client.getClientSearchees({
										includeFiles: true,
										includeTrackers: true,
									})
								).searchees,
						),
					);
				} else if (torrentDir) {
					rawSearchees = rawSearchees.concat(
						await loadTorrentDirLight(torrentDir),
					);
				}
				if (dataDirs.length) {
					const memoizedPaths = new Map<string, string[]>();
					const memoizedLengths = new Map<string, number>();
					rawSearchees = rawSearchees.concat(
						(
							await mapAsync(
								await findSearcheesFromAllDataDirs(),
								(path) =>
									createSearcheeFromPath(
										path,
										memoizedPaths,
										memoizedLengths,
									),
							)
						)
							.filter(isOk)
							.map((r) => r.unwrap()),
					);
				}
			}
		},
	);
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

	logger.info({
		label: Label.SEARCH,
		message: "Gathering searchees...",
	});
	const realSearchees = await findAllSearchees(Label.SEARCH);
	const ensembleSearchees = await createEnsembleSearchees(realSearchees, {
		useFilters: true,
	});
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
		...(await filterAsync(ensembleSearchees, (searchee) =>
			filterByContent(searchee, {
				configOverride: {},
				allowSeasonPackEpisodes: false,
				ignoreCrossSeeds: false,
				blockListOnly: true, // Only option that matters
			}),
		)),
		...(await filterAsync(realSearchees, filterByContent)),
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
		const results = await mapAsync(filteredSearchees, (searchee) =>
			filterTimestamps(searchee, options),
		);
		if (!results.some(isTruthy)) {
			grouping.delete(key);
			continue;
		}
		filteredSearchees.sort(
			comparing(
				(searchee) => byClientHostPriority(searchee.clientHost),
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
	const { dataDirs, torrentDir, useClientTorrents } = getRuntimeConfig();
	await indexTorrentsAndDataDirs();
	const enabledIndexers = await getEnabledIndexers();
	if (
		!enabledIndexers.length ||
		(!useClientTorrents && !torrentDir && !dataDirs.length)
	) {
		logger.error({
			label: Label.RSS,
			message:
				"RSS requires enabled indexers and at least one of useClientTorrents, torrentDir, or dataDirs to be set",
		});
		return;
	}
	logger.verbose({
		label: Label.RSS,
		message: "Querying RSS feeds...",
	});

	const lastRun = (await getJobLastRun(JobName.RSS)) ?? 0;
	await indexTorrentsAndDataDirs();
	let numCandidates = 0;
	await mapAsync(await queryRssFeeds(lastRun, enabledIndexers), async (candidates) => {
		for await (const candidate of candidates) {
			await checkNewCandidateMatch(candidate, Label.RSS);
			numCandidates++;
		}
	});

	logger.info({
		label: Label.RSS,
		message: `RSS scan complete - checked ${numCandidates} new candidates since ${humanReadableDate(lastRun)}`,
	});
}
