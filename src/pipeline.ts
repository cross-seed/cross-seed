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
import { db, memDB } from "./db.js";
import {
	assessCandidate,
	assessCandidateHelper,
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
	getSeasonKey,
	Searchee,
	SearcheeLabel,
	SearcheeWithLabel,
} from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	getInfoHashesToExclude,
	getTorrentByCriteria,
	getTorrentByName,
	indexNewTorrents,
	loadTorrentDirLight,
	parseInfoFromSavedTorrent,
	parseTorrentFromFilename,
	TorrentLocator,
} from "./torrent.js";
import {
	getSearchString,
	IndexerCandidates,
	queryRssFeeds,
	searchTorznab,
} from "./torznab.js";
import {
	formatAsList,
	getLogString,
	humanReadableSize,
	isTruthy,
	stripExtension,
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

interface AssessmentWithTracker {
	assessment: ResultAssessment;
	tracker: string;
}

interface FoundOnOtherSites {
	searchedIndexers: number;
	matches: number;
}

async function assessCandidates(
	candidates: Candidate[],
	searchee: Searchee,
	hashesToExclude: string[],
): Promise<AssessmentWithTracker[]> {
	const assessments: AssessmentWithTracker[] = [];
	for (const result of candidates) {
		const assessment = await assessCandidate(
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
	prevCandidates: Map<string, IndexerCandidates[]>,
	progress: string,
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	const searchStr = await getSearchString(searchee);
	const response = await searchTorznab(
		searchee,
		prevCandidates,
		searchStr,
		progress,
	);
	const searchedIndexers =
		response.length === prevCandidates.get(searchStr)?.length
			? 0
			: response.length;
	prevCandidates.set(searchStr, response);

	const results: Candidate[] = response.flatMap((e) =>
		e.candidates.map((candidate) => ({
			...candidate,
			indexerId: e.indexerId,
		})),
	);

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
	if (actionResults.includes(InjectionResult.TORRENT_NOT_COMPLETE)) {
		// If the torrent is not complete, "cancel the search"
		return { searchedIndexers: 0, matches: 0 };
	}

	await updateSearchTimestamps(searchee.name, Array.from(notRateLimited));

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
	const prevCandidates = new Map<string, IndexerCandidates[]>();
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			const sleepTime = delay * 1000 - (Date.now() - prevSearchTime);
			if (sleepTime > 0) {
				await new Promise((r) => setTimeout(r, sleepTime));
			}
			const searchTime = Date.now();

			const { searchedIndexers, matches } = await findOnOtherSites(
				searchee,
				hashesToExclude,
				prevCandidates,
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

	let searchees: Searchee[];
	if (criteria.path) {
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map(
				createSearcheeFromPath,
			),
		);
		searchees = searcheeResults.filter(isOk).map((t) => t.unwrap());
	} else {
		searchees = [await getTorrentByCriteria(criteria)];
	}
	searchees.map((s) => (s.label = Label.WEBHOOK));
	const hashesToExclude = await getInfoHashesToExclude();
	let totalFound = 0;
	let filtered = 0;
	const prevCandidates = new Map<string, IndexerCandidates[]>();
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			if (!filterByContent(searchee as SearcheeWithLabel)) {
				filtered++;
				continue;
			}
			const sleep = wait(delay * 1000);

			const { matches, searchedIndexers } = await findOnOtherSites(
				searchee as SearcheeWithLabel,
				hashesToExclude,
				prevCandidates,
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
	candidateLog: string,
	seasonFromEpisodes: boolean,
	searcheeLabel: SearcheeLabel,
): Promise<{
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}> {
	const searchees: Searchee[] = [];
	let method: string;
	if (seasonFromEpisodes) {
		const seasonKey = getSeasonKey(stripExtension(candidate.name));
		if (!seasonKey) return { decision: null, actionResult: null };
		const { ensembleTitle, keyTitle, season } = seasonKey;
		const key = `${keyTitle}.${season}`;
		const ensemble = await memDB("ensemble").where({ ensemble: key });
		if (ensemble.length === 0) {
			logger.verbose({
				label: searcheeLabel,
				message: `Did not find an ensemble ${ensembleTitle} for ${candidateLog}`,
			});
			return { decision: null, actionResult: null };
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
			return { decision: null, actionResult: null };
		}
		const uniqueElements = new Set(ensemble.map((e) => e.element));
		const totalLength = [...uniqueElements].reduce((acc, cur) => {
			const elements = ensemble.filter(
				(e) =>
					e.element === cur &&
					files.some((f) => f.path === e.absolute_path),
			);
			const avg =
				elements.reduce((a, c) => a + c.length, 0) / elements.length;
			return acc + avg;
		}, 0);
		searchees.push({
			name: ensembleTitle,
			files: files,
			length: totalLength,
			label: searcheeLabel,
		});
		logger.verbose({
			label: searcheeLabel,
			message: `Using ensemble ${ensembleTitle} for ${candidateLog}: ${humanReadableSize(totalLength)} - ${files.length} files`,
		});
		method = "ensemble";
	} else {
		const { keys, metas } = await getTorrentByName(candidate.name);
		method = keys.length ? `[${keys}]` : "Fuse fallback";
		if (!metas.length) {
			logger.verbose({
				label: searcheeLabel,
				message: `Did not find an existing entry using ${method} for ${candidateLog}`,
			});
			return { decision: null, actionResult: null };
		}
		const rawSearchees = metas.map(createSearcheeFromMetafile);
		rawSearchees.map((s) => (s.label = searcheeLabel));
		searchees.push(
			...filterDupesFromSimilar(rawSearchees.filter(filterByContent)),
		);
		if (!searchees.length) {
			logger.verbose({
				label: searcheeLabel,
				message: `No valid entries found using ${method} for ${candidateLog}`,
			});
			return { decision: null, actionResult: null };
		}
	}
	logger.verbose({
		label: searcheeLabel,
		message: `Unique entries [${searchees.map((m) => m.name)}] using ${method} for ${candidateLog}`,
	});

	const hashesToExclude = await getInfoHashesToExclude();

	let decision: Decision | null = null;
	let actionResult: ActionResult | null = null;
	searchees.sort((a, b) => b.files.length - a.files.length);
	for (const searchee of searchees) {
		await db("searchee")
			.insert({ name: searchee.name })
			.onConflict("name")
			.ignore();

		const assessment: ResultAssessment = await assessCandidate(
			candidate,
			searchee,
			hashesToExclude,
		);

		if (!isAnyMatchedDecision(assessment.decision)) {
			if (assessment.decision === Decision.INFO_HASH_ALREADY_EXISTS) {
				decision = assessment.decision;
				break;
			}
			continue;
		}
		decision = assessment.decision;

		actionResult = (
			await performAction(
				assessment.metafile!,
				assessment.decision,
				searchee,
				candidate.tracker,
			)
		).actionResult;
		sendResultsNotification(searchee as SearcheeWithLabel, [
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

async function findSearchableTorrents(
	searcheeLabel: SearcheeLabel,
	useFilters: boolean,
): Promise<{
	searchees: SearcheeWithLabel[];
	hashesToExclude: string[];
}> {
	const { torrents, dataDirs, torrentDir, searchLimit } = getRuntimeConfig();
	const allSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile), //also create searchee from path
		);
		allSearchees.push(
			...searcheeResults.filter(isOk).map((r) => r.unwrap()),
		);
	} else {
		if (typeof torrentDir === "string") {
			allSearchees.push(...(await loadTorrentDirLight(torrentDir)));
		}
		if (Array.isArray(dataDirs)) {
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map(createSearcheeFromPath),
			);
			allSearchees.push(
				...searcheeResults.filter(isOk).map((r) => r.unwrap()),
			);
		}
	}
	allSearchees.map((s) => (s.label = searcheeLabel));

	const hashesToExclude = allSearchees
		.map((t) => t.infoHash)
		.filter(isTruthy);
	const ensembleSearchees = await createEnsembleSearchees(
		allSearchees,
		useFilters,
	);

	if (!useFilters) {
		return {
			searchees: [
				...allSearchees,
				...ensembleSearchees,
			] as SearcheeWithLabel[],
			hashesToExclude,
		};
	}
	const filteredSearchees = [
		...ensembleSearchees, // Search first as it uses timestamp for logic
		...allSearchees.filter(filterByContent),
	];

	// Group the exact same search queries together for easy cache use later
	const grouping = new Map<string, Searchee[]>();
	for (const searchee of filteredSearchees) {
		const key = await getSearchString(searchee);
		if (!grouping.has(key)) {
			grouping.set(key, []);
		}
		grouping.get(key)!.push(searchee);
	}
	const keysToDelete: string[] = [];
	for (const [key, rawSearchees] of grouping) {
		// Dedupe searchees if equal in length and files, prefer infoHash
		rawSearchees.sort((a, b) => {
			if (a.infoHash && !b.infoHash) return -1;
			if (!a.infoHash && b.infoHash) return 1;
			return 0;
		});
		// If one searchee needs to be searched, use the candidates for all
		const searchees = filterDupesFromSimilar(rawSearchees);
		const results = await Promise.all(searchees.map(filterTimestamps));
		if (!results.some(isTruthy)) {
			keysToDelete.push(key);
			continue;
		}
		// Sort by most number files (less chance of partial)
		searchees.sort((a, b) => {
			return b.files.length - a.files.length; // Already sorted by hash
		});
		grouping.set(key, searchees);
	}
	for (const key of keysToDelete) {
		grouping.delete(key);
	}
	let finalSearchees = Array.from(grouping.values()).flat();

	logger.info({
		label: Label.SEARCH,
		message: `Found ${allSearchees.length} torrents, ${finalSearchees.length} suitable to search for matches using ${grouping.size} unique queries`,
	});

	if (searchLimit && finalSearchees.length > searchLimit) {
		logger.info({
			label: Label.SEARCH,
			message: `Limited to ${searchLimit} searches`,
		});
		finalSearchees = finalSearchees.slice(0, searchLimit);
	}

	return {
		searchees: finalSearchees as SearcheeWithLabel[],
		hashesToExclude,
	};
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { searchees, hashesToExclude } = await findSearchableTorrents(
		Label.SEARCH,
		true,
	);

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
	const { seasonFromEpisodes, torznab } = getRuntimeConfig();
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
			await checkNewCandidateMatch(
				candidate,
				candidateLog,
				false,
				Label.RSS,
			);
			if (seasonFromEpisodes) {
				await checkNewCandidateMatch(
					candidate,
					candidateLog,
					true,
					Label.RSS,
				);
			}
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}

export async function injectSavedTorrents() {
	const { flatLinking, injectDir, linkDir, outputDir } = getRuntimeConfig();
	const targetDir = injectDir ?? outputDir;
	const targetDirLog = chalk.bold.magenta(targetDir);

	if (injectDir) {
		// injectDir defined only by `cross-seed inject`
		logger.warn({
			label: Label.INJECT,
			message: `Manually injecting torrents performs minimal filtering which slightly increases chances of false positives, see the docs for more info`,
		});
	}
	if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
		logger.info({
			label: Label.INJECT,
			message: `No directory found at ${targetDirLog} - ensure it exists and is accessible (verify docker volumes if applicable)`,
		});
		return;
	}
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

	const { searchees } = await findSearchableTorrents(Label.INJECT, false);

	const toDelete = new Set<string>();
	const toRecheck = new Set<string>();

	// Usually source got deleted or partial injection never completes
	function shouldCleanUpTorrent(torrentFilePath: string) {
		return fs.statSync(torrentFilePath).mtimeMs < Date.now() - ms("1 week");
	}

	let totalInjected = 0;
	let totalFullMatches = 0;
	let totalPartialMatches = 0;
	let totalBlocked = 0;
	let totalAlreadyExists = 0;
	let totalCandidateIncomplete = 0;
	let totalSearcheeIncomplete = 0;
	let totalFailed = 0;
	let totalUnmatched = 0;
	let count = 0;
	let foundBadFormat = false;
	for (const torrentFilePath of dirContents) {
		const progress = chalk.blue(`(${++count}/${dirContents.length})`);
		const filePathLog = chalk.bold.magenta(torrentFilePath);
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
			foundBadFormat = true;
		}

		// Decide stage
		const fullMatches: [
			SearcheeWithLabel,
			Decision.MATCH | Decision.MATCH_SIZE_ONLY,
		][] = [];
		const partialMatches: [SearcheeWithLabel, Decision.MATCH_PARTIAL][] =
			[];
		let foundBlocked = false;
		for (const searchee of searchees) {
			const { decision } = await assessCandidateHelper(
				meta,
				searchee,
				[],
			);
			if (decision === Decision.MATCH) {
				fullMatches.unshift([searchee, decision]);
			} else if (decision === Decision.MATCH_SIZE_ONLY) {
				fullMatches.push([searchee, decision]);
			} else if (decision === Decision.MATCH_PARTIAL) {
				partialMatches.push([searchee, decision]);
			} else if (decision === Decision.BLOCKED_RELEASE) {
				foundBlocked = true;
			}
		}
		fullMatches.sort((a, b) => {
			// Prefer torrent over data/virtual
			if (a[0].infoHash && !b[0].infoHash) {
				return -1;
			}
			if (!a[0].infoHash && b[0].infoHash) {
				return 1;
			}
			return 0; // Should keep MATCH first within a searchee type
		});
		partialMatches.sort((a, b) => {
			// Prefer torrent/data over virtual
			if ((a[0].infoHash || a[0].path) && !(b[0].infoHash || b[0].path)) {
				return -1;
			}
			if (!(a[0].infoHash || a[0].path) && (b[0].infoHash || b[0].path)) {
				return 1;
			}
			return b[0].files.length - a[0].files.length; // Prefer more files
		});
		if (fullMatches.length === 0 && partialMatches.length === 0) {
			if (foundBlocked) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.yellow("possibly blocklisted")}: ${filePathLog}`,
				});
				totalBlocked++;
			} else {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.red("has no matches")}: ${filePathLog}`,
				});
				totalUnmatched++;
			}
			continue;
		}

		// Action stage
		let injectionResult = InjectionResult.FAILURE;
		let matchedSearchee: SearcheeWithLabel;
		let matchedDecision: DecisionAnyMatch;
		let linkedNewFiles = false;
		for (const [searchee, decision] of [
			...fullMatches,
			...partialMatches,
		]) {
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
		if (injectionResult === InjectionResult.FAILURE) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to inject ${filePathLog} - ${chalk.red(injectionResult)}`,
			});
			totalFailed++;
			continue;
		}
		if (injectionResult === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (
				linkDir &&
				fs.statSync(torrentFilePath).mtimeMs < Date.now() - ms("1 day")
			) {
				// Since source is stalled, add to client paused so user can resume later if desired
				const linkedFilesRootResult = await linkAllFilesInMetafile(
					matchedSearchee!,
					meta,
					tracker,
					matchedDecision!,
					false,
				);
				const inClient = await getClient().isTorrentComplete(
					meta.infoHash,
				);
				if (inClient.isOk()) {
					if (
						linkedFilesRootResult.isOk() &&
						linkedFilesRootResult.unwrap().linkedNewFiles
					) {
						logger.info({
							label: Label.INJECT,
							message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
						});
						toRecheck.add(meta.infoHash);
					} else {
						logger.warn({
							label: Label.INJECT,
							message: `${progress} No new files linked for ${filePathLog}, resume or remove from client - ${chalk.yellow(injectionResult)}`,
						});
					}
				} else {
					if (linkedFilesRootResult.isOk()) {
						const linkResult = linkedFilesRootResult.unwrap();
						const destinationDir = dirname(linkResult.contentPath);
						const result = await getClient().inject(
							meta,
							matchedSearchee!,
							Decision.MATCH_PARTIAL, // Should always be considered partial
							destinationDir,
						);
						// result is only SUCCESS or FAILURE here but still log original injectionResult
						if (result === InjectionResult.SUCCESS) {
							logger.info({
								label: Label.INJECT,
								message: `${progress} Injected ${filePathLog} using stalled source, you will need to resume or remove from client - ${chalk.green(injectionResult)}`,
							});
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
				toDelete.delete(torrentFilePath);
			} else {
				// Normal case where source is likely still downloading
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}`,
				});
			}
			totalSearcheeIncomplete++;
			continue;
		}
		const result = await getClient().isTorrentComplete(meta.infoHash);
		const isComplete = result.isOk() ? result.unwrap() : false;
		if (isComplete) {
			toDelete.add(torrentFilePath);
		}
		if (injectionResult === InjectionResult.ALREADY_EXISTS) {
			if (linkedNewFiles) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
				});
				toRecheck.add(meta.infoHash);
			} else {
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}${isComplete ? "" : " (incomplete)"}`,
				});
			}
			totalAlreadyExists++;
			totalCandidateIncomplete += isComplete ? 0 : 1;
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
		totalInjected++;
		if (matchedDecision! === Decision.MATCH_PARTIAL) {
			totalPartialMatches++;
		} else {
			totalFullMatches++;
		}
	}

	for (const infoHash of toRecheck) {
		await getClient().recheckTorrent(infoHash);
	}

	const incompleteMsg = `${chalk.bold.yellow(totalAlreadyExists)} existed in client${
		totalCandidateIncomplete
			? chalk.dim(` (${totalCandidateIncomplete} were incomplete)`)
			: ""
	}`;
	const resultMsg = formatAsList(
		[
			`Injected ${chalk.bold.green(totalInjected)}/${chalk.bold.white(dirContents.length)} torrents`,
			totalFullMatches &&
				`${chalk.bold.green(totalFullMatches)} were full matches`,
			totalPartialMatches &&
				`${chalk.bold.yellow(totalPartialMatches)} were partial matches`,
			totalSearcheeIncomplete &&
				`${chalk.bold.yellow(totalSearcheeIncomplete)} had incomplete sources`,
			totalAlreadyExists && incompleteMsg,
			totalBlocked &&
				`${chalk.bold.yellow(totalBlocked)} were possibly blocklisted`,
			totalFailed && `${chalk.bold.red(totalFailed)} failed to inject`,
			totalUnmatched &&
				`${chalk.bold.red(totalUnmatched)} had no matches`,
		].filter(isTruthy),
		false,
		true,
	);
	logger.info({ label: Label.INJECT, message: chalk.cyan(resultMsg) });

	if (totalUnmatched > 0) {
		logger.info({
			label: Label.INJECT,
			message: `Use "${chalk.bold.white("cross-seed diff")}" to get the reasons two torrents are not considered matches`,
		});
	}

	if (!flatLinking && foundBadFormat) {
		logger.warn({
			label: Label.INJECT,
			message: `Some torrents could be linked to linkDir/${UNKNOWN_TRACKER} - follow .torrent naming format in the docs to avoid this`,
		});
	}

	for (const torrentFilePath of toDelete) {
		try {
			if (shouldCleanUpTorrent(torrentFilePath)) {
				logger.warn({
					label: Label.INJECT,
					message: `Deleting ${torrentFilePath} as it has failed to inject for too long`,
				});
			} else {
				logger.info({
					label: Label.INJECT,
					message: `Deleting ${torrentFilePath} as it's in client and complete`,
				});
			}
			fs.unlinkSync(torrentFilePath);
		} catch (e) {
			logger.error({
				label: Label.INJECT,
				message: `Failed to delete ${torrentFilePath}`,
			});
			logger.debug(e);
		}
	}
}
