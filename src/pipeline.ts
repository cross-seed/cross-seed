import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import { performAction, performActions } from "./action.js";
import {
	ActionResult,
	Decision,
	InjectionResult,
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
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createEnsembleSearchees,
	createSearcheeFromMetafile,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	getSeasonKey,
	Searchee,
} from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	getInfoHashesToExclude,
	getTorrentByCriteria,
	getTorrentByFuzzyName,
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
import { humanReadableSize, isTruthy, stripExtension } from "./utils.js";
import { Metafile } from "./parseTorrent.js";
import { getClient } from "./clients/TorrentClient.js";

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
	searchee: Searchee,
	hashesToExclude: string[],
	prevCandidates: Map<string, IndexerCandidates[]>,
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	let response: IndexerCandidates[];
	let searchedCacheOnly = false;
	try {
		const searchStr = await getSearchString(searchee);
		response = await searchTorznab(searchee, prevCandidates, searchStr);
		if (
			response.length > 0 &&
			response.length === prevCandidates.get(searchStr)?.length
		) {
			searchedCacheOnly = true;
		}
		prevCandidates.set(searchStr, response);
	} catch (e) {
		if (!e.message.includes("SKIPPED")) {
			logger.error(`error searching for ${searchee.name}`);
			logger.debug(e);
		}
		return { searchedIndexers: 0, matches: 0 };
	}
	const searchedIndexers = searchedCacheOnly ? 0 : response.length;

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

	const matches = assessments.filter(
		(e) =>
			e.assessment.decision === Decision.MATCH ||
			e.assessment.decision === Decision.MATCH_SIZE_ONLY ||
			e.assessment.decision === Decision.MATCH_PARTIAL,
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
	sendResultsNotification(searchee, zipped, Label.SEARCH);

	return { searchedIndexers, matches: matches.length };
}

async function findMatchesBatch(
	samples: Searchee[],
	hashesToExclude: string[],
) {
	const { delay } = getRuntimeConfig();

	let totalFound = 0;
	let prevSearchTime = 0;
	const prevCandidates = new Map<string, IndexerCandidates[]>();
	for (const [i, sample] of samples.entries()) {
		try {
			const sleepTime = delay * 1000 - (Date.now() - prevSearchTime);
			if (sleepTime > 0) {
				await new Promise((r) => setTimeout(r, sleepTime));
			}
			const searchTime = Date.now();

			const progress = chalk.blue(`[${i + 1}/${samples.length}]`);
			const name = stripExtension(sample.name);
			logger.info("%s %s %s", progress, chalk.dim("Searching for"), name);

			const { searchedIndexers, matches } = await findOnOtherSites(
				sample,
				hashesToExclude,
				prevCandidates,
			);
			totalFound += matches;

			// if all indexers were rate limited or cached, don't sleep
			if (searchedIndexers === 0) continue;
			prevSearchTime = searchTime;
		} catch (e) {
			logger.error(`error searching for ${sample.name}`);
			logger.debug(e);
		}
	}
	return totalFound;
}

export async function searchForLocalTorrentByCriteria(
	criteria: TorrentLocator,
): Promise<number | null> {
	const { maxDataDepth } = getRuntimeConfig();

	let searchees: Searchee[];
	if (criteria.path) {
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map(
				createSearcheeFromPath,
			),
		);
		searchees = searcheeResults.map((t) => t.unwrapOrThrow());
	} else {
		searchees = [await getTorrentByCriteria(criteria)];
	}
	const hashesToExclude = await getInfoHashesToExclude();
	let matches = 0;
	const prevCandidates = new Map<string, IndexerCandidates[]>();
	for (let i = 0; i < searchees.length; i++) {
		if (!filterByContent(searchees[i])) return null;
		const foundOnOtherSites = await findOnOtherSites(
			searchees[i],
			hashesToExclude,
			prevCandidates,
		);
		matches += foundOnOtherSites.matches;
	}
	return matches;
}

export async function checkNewCandidateMatch(
	candidate: Candidate,
	seasonFromEpisodes: boolean,
): Promise<InjectionResult | SaveResult | null> {
	const candidateLog = `${candidate.tracker}: ${candidate.name}`;
	let searchee: Searchee;
	if (seasonFromEpisodes) {
		const key = await getSeasonKey(candidate.name);
		if (!key) return null;
		const ensemble = await memDB("ensemble").where({ ensemble: key });
		if (ensemble.length === 0) {
			logger.verbose({
				label: Label.REVERSE_LOOKUP,
				message: `Did not find an ensemble from ${candidateLog} - ${key}`,
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
				label: Label.REVERSE_LOOKUP,
				message: `Did not find any files for ensemble ${key} from ${candidateLog} - sources may be incomplete or missing`,
			});
			return null;
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
		searchee = { name: key, files: files, length: totalLength };
		logger.verbose({
			label: Label.REVERSE_LOOKUP,
			message: `Found ensemble from ${candidateLog} (${key}) - ${humanReadableSize(totalLength)} - ${files.length} files`,
		});
	} else {
		const meta = await getTorrentByFuzzyName(candidate.name);
		if (meta === null) {
			logger.verbose({
				label: Label.REVERSE_LOOKUP,
				message: `Did not find an existing entry from ${candidateLog}`,
			});
			return null;
		}
		if (!filterByContent(meta)) return null;
		searchee = createSearcheeFromMetafile(meta);
	}

	const hashesToExclude = await getInfoHashesToExclude();

	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	const assessment: ResultAssessment = await assessCandidate(
		candidate,
		searchee,
		hashesToExclude,
	);

	if (
		assessment.decision !== Decision.MATCH &&
		assessment.decision !== Decision.MATCH_SIZE_ONLY &&
		assessment.decision !== Decision.MATCH_PARTIAL
	) {
		return null;
	}

	const result = await performAction(
		assessment.metafile!,
		assessment.decision,
		searchee,
		candidate.tracker,
	);
	await sendResultsNotification(
		searchee,
		[[assessment, candidate.tracker, result]],
		Label.REVERSE_LOOKUP,
	);
	return result;
}

async function findSearchableTorrents(useFilters: boolean) {
	const { torrents, dataDirs, torrentDir, searchLimit } = getRuntimeConfig();
	let allSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile), //also create searchee from path
		);
		allSearchees = searcheeResults
			.filter((t) => t.isOk())
			.map((t) => t.unwrapOrThrow());
	} else {
		if (typeof torrentDir === "string") {
			allSearchees.push(...(await loadTorrentDirLight(torrentDir)));
		}
		if (Array.isArray(dataDirs)) {
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map(createSearcheeFromPath),
			);
			allSearchees.push(
				...searcheeResults
					.filter((t) => t.isOk())
					.map((t) => t.unwrapOrThrow()),
			);
		}
	}

	const hashesToExclude = allSearchees
		.map((t) => t.infoHash)
		.filter(isTruthy);

	// Best to search ensemble first as it relies on file dates and search time
	let finalSearchees = await createEnsembleSearchees(
		allSearchees,
		useFilters,
	);
	if (useFilters) {
		const filteredTorrents =
			filterDupes(allSearchees).filter(filterByContent);
		finalSearchees.push(...filteredTorrents);
	} else {
		finalSearchees.unshift(...allSearchees); // Check actual torrents first
		return { samples: finalSearchees, hashesToExclude };
	}

	// Group the exact same search queries together for easy cache use later
	const grouping = new Map<string, Searchee[]>();
	for (const searchee of finalSearchees) {
		const key = await getSearchString(searchee);
		if (!grouping.has(key)) {
			grouping.set(key, []);
		}
		grouping.get(key)!.push(searchee);
	}
	const keysToDelete: string[] = [];
	for (const [key, searchees] of grouping) {
		// If one searchee needs to be searched, use the candidates for all
		const results = await Promise.all(searchees.map(filterTimestamps));
		if (!results.some(isTruthy)) {
			keysToDelete.push(key);
			continue;
		}
		// Sort by most number files (less chance of partial) then if infoHash
		searchees.sort((a, b) => {
			if (a.files.length !== b.files.length) {
				return b.files.length - a.files.length;
			}
			if (a.infoHash) return -1;
			return 1;
		});
	}
	for (const key of keysToDelete) {
		grouping.delete(key);
	}
	finalSearchees = Array.from(grouping.values()).flat();

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

	return { samples: finalSearchees, hashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { samples, hashesToExclude } = await findSearchableTorrents(true);

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	if (linkDir && !fs.existsSync(linkDir)) {
		fs.mkdirSync(linkDir, { recursive: true });
	}

	const totalFound = await findMatchesBatch(samples, hashesToExclude);

	logger.info({
		label: Label.SEARCH,
		message: chalk.cyan(
			`Found ${chalk.bold.white(
				totalFound,
			)} cross seeds from ${chalk.bold.white(
				samples.length,
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
			logger.verbose({
				label: Label.RSS,
				message: `Processing release ${i + 1}/${
					candidatesSinceLastTime.length
				}`,
			});
			await checkNewCandidateMatch(candidate, false);
			if (seasonFromEpisodes) {
				await checkNewCandidateMatch(candidate, true);
			}
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}

export async function injectSavedTorrents() {
	const { flatLinking, injectDir, outputDir } = getRuntimeConfig();
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

	const deleteTorrent = function (filePath, progress, filePathLog) {
		try {
			fs.unlinkSync(filePath);
		} catch (e) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to delete ${filePathLog}`,
			});
			logger.debug(e);
		}
	};

	const { samples, hashesToExclude } = await findSearchableTorrents(false);
	let totalInjected = 0;
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
		const metaLog = `${chalk.bold.white(meta.name)} ${chalk.dim(`[${meta.infoHash.slice(0, 8)}...]`)}`;

		const torrentNameInfo =
			await parseInfoFromSavedTorrent(torrentFilePath);
		const tracker = torrentNameInfo?.tracker ?? UNKNOWN_TRACKER;
		if (tracker === UNKNOWN_TRACKER) {
			foundBadFormat = true;
		}

		// Decide stage
		const fullMatches: [
			Searchee,
			Decision.MATCH | Decision.MATCH_SIZE_ONLY,
		][] = [];
		const partialMatches: [Searchee, Decision.MATCH_PARTIAL][] = [];
		let foundBlocked = false;
		let foundAlreadyExists = false;
		for (const searchee of samples) {
			const dec = (
				await assessCandidateHelper(meta, searchee, hashesToExclude)
			).decision;
			if (dec === Decision.MATCH || dec === Decision.MATCH_SIZE_ONLY) {
				fullMatches.push([searchee, dec]);
			} else if (dec === Decision.MATCH_PARTIAL) {
				partialMatches.push([searchee, dec]);
			} else if (dec === Decision.INFO_HASH_ALREADY_EXISTS) {
				foundAlreadyExists = true;
			} else if (dec === Decision.BLOCKED_RELEASE) {
				foundBlocked = true;
			}
		}
		if (fullMatches.length === 0 && partialMatches.length === 0) {
			if (foundAlreadyExists) {
				const res = await getClient().isTorrentComplete(meta.infoHash);
				const isComplete = res.isOk() ? res.unwrapOrThrow() : false;
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} already exists${isComplete ? "" : " (incomplete)"} in client: ${filePathLog}`,
				});
				totalAlreadyExists++;
				totalCandidateIncomplete += isComplete ? 0 : 1;
				if (isComplete) {
					deleteTorrent(torrentFilePath, progress, filePathLog);
				}
			} else if (foundBlocked) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} possibly blocklisted: ${filePathLog}`,
				});
				totalBlocked++;
			} else {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} has no matches: ${filePathLog}`,
				});
				totalUnmatched++;
			}
			continue;
		}

		// Action stage
		let injectionResult = InjectionResult.FAILURE;
		let matchedSearchee: Searchee;
		let matchedDecision: Decision;
		for (const [searchee, decision] of [
			...fullMatches,
			...partialMatches,
		]) {
			if (
				injectionResult === InjectionResult.TORRENT_NOT_COMPLETE &&
				(decision === Decision.MATCH_PARTIAL || !searchee.infoHash)
			) {
				continue; // Don't check partial/data/virtual if incomplete
			}
			const result = await performAction(
				meta,
				decision,
				searchee,
				tracker,
				injectionResult !== InjectionResult.SUCCESS,
			);
			if (
				injectionResult === InjectionResult.SUCCESS ||
				[InjectionResult.FAILURE, SaveResult.SAVED].includes(result)
			) {
				continue;
			}
			if (result === InjectionResult.ALREADY_EXISTS) {
				injectionResult = result;
				continue;
			} else if (result === InjectionResult.TORRENT_NOT_COMPLETE) {
				if (injectionResult !== InjectionResult.ALREADY_EXISTS) {
					injectionResult = result;
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
			logger.warn({
				label: Label.INJECT,
				message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}`,
			});
			totalSearcheeIncomplete++;
			continue;
		}
		const result = await getClient().isTorrentComplete(meta.infoHash);
		const isComplete = result.isOk() ? result.unwrapOrThrow() : false;
		if (isComplete) {
			deleteTorrent(torrentFilePath, progress, filePathLog);
		}
		if (injectionResult === InjectionResult.ALREADY_EXISTS) {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}${isComplete ? "" : " (incomplete)"}`,
			});
			totalAlreadyExists++;
			totalCandidateIncomplete += isComplete ? 0 : 1;
			continue;
		}
		logger.info({
			label: Label.INJECT,
			message: `${progress} Injected ${filePathLog} - ${chalk.green(injectionResult)}`,
		});
		sendResultsNotification(
			matchedSearchee!,
			[
				[
					{ decision: matchedDecision!, metafile: meta },
					tracker,
					injectionResult,
				],
			],
			Label.INJECT,
		);
		totalInjected++;
	}
	let msg = `Injected ${chalk.bold.green(totalInjected)}/${chalk.bold.white(dirContents.length)} torrents`;
	if (totalSearcheeIncomplete) {
		msg += `, ${chalk.bold.yellow(totalSearcheeIncomplete)} had incomplete searchees`;
	}
	if (totalAlreadyExists) {
		msg += `, ${chalk.bold.yellow(totalAlreadyExists)} existed in client`;
		if (totalCandidateIncomplete) {
			msg += chalk.dim(` (${totalCandidateIncomplete} were incomplete)`);
		}
	}
	if (totalBlocked) {
		msg += `, ${chalk.bold.yellow(totalBlocked)} were possibly blocklisted`;
	}
	if (totalFailed) {
		msg += `, ${chalk.bold.red(totalFailed)} failed to inject`;
	}
	if (totalUnmatched) {
		msg += `, ${chalk.bold.red(totalUnmatched)} had no matches`;
	}
	logger.info({ label: Label.INJECT, message: chalk.cyan(msg) });

	if (!flatLinking && foundBadFormat) {
		logger.warn({
			label: Label.INJECT,
			message: `Some torrents could be linked to linkDir/${UNKNOWN_TRACKER} - follow .torrent naming format in the docs to avoid this`,
		});
	}
}
