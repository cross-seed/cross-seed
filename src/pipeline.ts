import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import ms from "ms";
import { performAction, performActions } from "./action.js";
import {
	ActionResult,
	Decision,
	InjectionResult,
	isAnyMatchedDecision,
	SaveResult,
} from "./constants.js";
import {
	findPotentialNestedRoots,
	findSearcheesFromAllDataDirs,
} from "./dataFiles.js";
import { db } from "./db.js";
import { assessCandidate, ResultAssessment } from "./decide.js";
import {
	IndexerStatus,
	updateIndexerStatus,
	updateSearchTimestamps,
} from "./indexers.js";
import { Label, logger } from "./logger.js";
import {
	filterByContent,
	filterDupes,
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
	getTorrentByCriteria,
	getTorrentByName,
	indexNewTorrents,
	loadTorrentDirLight,
	TorrentLocator,
} from "./torrent.js";
import { queryRssFeeds, searchTorznab } from "./torznab.js";
import { filterAsync, getLogString, isTruthy, wait } from "./utils.js";

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
	progress: string,
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	const response = await searchTorznab(searchee, progress);

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
		return { matches: 0, searchedIndexers: 0 };
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

	return { matches: matches.length, searchedIndexers: response.length };
}

async function findMatchesBatch(
	searchees: SearcheeWithLabel[],
	hashesToExclude: string[],
) {
	const { delay } = getRuntimeConfig();

	let totalFound = 0;
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			const sleep = wait(delay * 1000);

			const { matches, searchedIndexers } = await findOnOtherSites(
				searchee,
				hashesToExclude,
				progress,
			);
			totalFound += matches;

			// if all indexers were rate limited, don't sleep
			if (searchedIndexers === 0) continue;
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
	return totalFound;
}

export async function searchForLocalTorrentByCriteria(
	criteria: TorrentLocator,
): Promise<number | null> {
	const { delay, maxDataDepth } = getRuntimeConfig();

	let rawSearchees: Searchee[];
	if (criteria.path) {
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map(
				createSearcheeFromPath,
			),
		);
		rawSearchees = searcheeResults.filter(isOk).map((t) => t.unwrap());
	} else {
		rawSearchees = [await getTorrentByCriteria(criteria)];
	}
	const searchees: SearcheeWithLabel[] = rawSearchees.map((searchee) => ({
		...searchee,
		label: Label.WEBHOOK,
	}));
	const hashesToExclude = await getInfoHashesToExclude();
	let totalFound = 0;
	let filtered = 0;
	for (const [i, searchee] of searchees.entries()) {
		const progress = chalk.blue(`(${i + 1}/${searchees.length}) `);
		try {
			if (!filterByContent(searchee)) {
				filtered++;
				continue;
			}
			const sleep = wait(delay * 1000);

			const { matches, searchedIndexers } = await findOnOtherSites(
				searchee,
				hashesToExclude,
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
): Promise<InjectionResult | SaveResult | null> {
	const candidateLog = `${candidate.name} from ${candidate.tracker}`;
	const { keys, metas } = await getTorrentByName(candidate.name);
	const method = keys.length ? `[${keys}]` : "Fuse fallback";
	if (!metas.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `Did not find an existing entry using ${method} for ${candidateLog}`,
		});
		return null;
	}
	const searchees: SearcheeWithLabel[] = filterDupesFromSimilar(
		metas.map(createSearcheeFromMetafile).filter(filterByContent),
	).map((searchee) => ({ ...searchee, label: searcheeLabel }));
	if (!searchees.length) {
		logger.verbose({
			label: searcheeLabel,
			message: `No valid entries found using ${method} for ${candidateLog}`,
		});
		return null;
	}
	logger.verbose({
		label: searcheeLabel,
		message: `Unique entries [${searchees.map((m) => m.name)}] using ${method} for ${candidateLog}`,
	});

	const hashesToExclude = await getInfoHashesToExclude();

	let result: InjectionResult | SaveResult | null = null;
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
			continue;
		}

		result = await performAction(
			assessment.metafile!,
			assessment.decision,
			searchee,
			candidate.tracker,
		);
		sendResultsNotification(searchee, [
			[assessment, candidate.tracker, result],
		]);
		if (
			result === SaveResult.SAVED ||
			result === InjectionResult.SUCCESS ||
			result === InjectionResult.ALREADY_EXISTS
		) {
			break;
		}
	}
	return result;
}

async function findSearchableTorrents(searcheeLabel: SearcheeLabel): Promise<{
	searchees: SearcheeWithLabel[];
	hashesToExclude: string[];
}> {
	const { torrents, dataDirs, torrentDir, searchLimit } = getRuntimeConfig();
	let rawSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile), //also create searchee from path
		);
		rawSearchees = searcheeResults.filter(isOk).map((r) => r.unwrap());
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
	const allSearchees: SearcheeWithLabel[] = rawSearchees.map((searchee) => ({
		...searchee,
		label: searcheeLabel,
	}));

	const hashesToExclude = allSearchees
		.map((t) => t.infoHash)
		.filter(isTruthy);
	let filteredTorrents: SearcheeWithLabel[] = await filterAsync(
		filterDupes(allSearchees).filter(filterByContent),
		filterTimestamps,
	);

	logger.info({
		label: Label.SEARCH,
		message: `Found ${allSearchees.length} torrents, ${filteredTorrents.length} suitable to search for matches`,
	});

	if (searchLimit && filteredTorrents.length > searchLimit) {
		logger.info({
			label: Label.SEARCH,
			message: `Limited to ${searchLimit} searches`,
		});

		filteredTorrents = filteredTorrents.slice(0, searchLimit);
	}

	return { searchees: filteredTorrents, hashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { searchees, hashesToExclude } = await findSearchableTorrents(
		Label.SEARCH,
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
			logger.verbose({
				label: Label.RSS,
				message: `Processing release ${i + 1}/${
					candidatesSinceLastTime.length
				}`,
			});
			await checkNewCandidateMatch(candidate, Label.RSS);
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}
