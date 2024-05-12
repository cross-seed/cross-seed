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
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromMetafile,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	Searchee,
} from "./searchee.js";
import {
	getInfoHashesToExclude,
	getTorrentByCriteria,
	getTorrentByFuzzyName,
	indexNewTorrents,
	loadTorrentDirLight,
	TorrentLocator,
} from "./torrent.js";
import { queryRssFeeds, searchTorznab } from "./torznab.js";
import { filterAsync, isTruthy, stripExtension } from "./utils.js";

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
): Promise<FoundOnOtherSites> {
	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	let response: { indexerId: number; candidates: Candidate[] }[];
	try {
		response = await searchTorznab(searchee);
	} catch (e) {
		logger.error(`error searching for ${searchee.name}`);
		logger.debug(e);
		return { searchedIndexers: 0, matches: 0 };
	}

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
	sendResultsNotification(searchee, zipped, Label.SEARCH);

	return { matches: matches.length, searchedIndexers: response.length };
}

async function findMatchesBatch(
	samples: Searchee[],
	hashesToExclude: string[],
) {
	const { delay } = getRuntimeConfig();

	let totalFound = 0;
	for (const [i, sample] of samples.entries()) {
		try {
			const sleep = new Promise((r) => setTimeout(r, delay * 1000));

			const progress = chalk.blue(`[${i + 1}/${samples.length}]`);
			const name = stripExtension(sample.name);
			logger.info("%s %s %s", progress, chalk.dim("Searching for"), name);

			const { matches, searchedIndexers } = await findOnOtherSites(
				sample,
				hashesToExclude,
			);
			totalFound += matches;

			// if all indexers were rate limited, don't sleep
			if (searchedIndexers === 0) continue;
			await sleep;
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
		searchees = searcheeResults.map((t) =>
			t.unwrapOrThrow(new Error("Failed to unwrap error searchee")),
		);
	} else {
		searchees = [await getTorrentByCriteria(criteria)];
	}
	const hashesToExclude = await getInfoHashesToExclude();
	let matches = 0;
	for (let i = 0; i < searchees.length; i++) {
		if (!filterByContent(searchees[i])) return null;
		const foundOnOtherSites = await findOnOtherSites(
			searchees[i],
			hashesToExclude,
		);
		matches += foundOnOtherSites.matches;
	}
	return matches;
}

export async function checkNewCandidateMatch(
	candidate: Candidate,
): Promise<InjectionResult | SaveResult | null> {
	const meta = await getTorrentByFuzzyName(candidate.name);
	if (meta === null) {
		logger.verbose({
			label: Label.REVERSE_LOOKUP,
			message: `Did not find an existing entry for ${candidate.name}`,
		});
		return null;
	}

	const hashesToExclude = await getInfoHashesToExclude();
	if (!filterByContent(meta)) return null;
	const searchee = createSearcheeFromMetafile(meta);

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

async function findSearchableTorrents() {
	const { torrents, dataDirs, torrentDir, searchLimit } = getRuntimeConfig();
	let allSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile), //also create searchee from path
		);
		allSearchees = searcheeResults.flatMap((r) => r.toArray());
	} else {
		if (typeof torrentDir === "string") {
			allSearchees.push(...(await loadTorrentDirLight(torrentDir)));
		}
		if (Array.isArray(dataDirs)) {
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map(createSearcheeFromPath),
			);
			allSearchees.push(...searcheeResults.flatMap((t) => t.toArray()));
		}
	}

	const hashesToExclude = allSearchees
		.map((t) => t.infoHash)
		.filter(isTruthy);
	let filteredTorrents = await filterAsync(
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

	return { samples: filteredTorrents, hashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { samples, hashesToExclude } = await findSearchableTorrents();

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
			await checkNewCandidateMatch(candidate);
		}
		logger.info({ label: Label.RSS, message: "Scan complete" });
	}
}
