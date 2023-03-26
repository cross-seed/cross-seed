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
import {
	EmptyNonceOptions,
	getRuntimeConfig,
	NonceOptions,
} from "./runtimeConfig.js";
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
import { filterAsync, stripExtension } from "./utils.js";

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

async function findOnOtherSites(
	searchee: Searchee,
	hashesToExclude: string[],
	nonceOptions: NonceOptions = EmptyNonceOptions
): Promise<number> {
	const assessEach = async (
		result: Candidate
	): Promise<AssessmentWithTracker> => ({
		assessment: await assessCandidate(result, searchee, hashesToExclude),
		tracker: result.tracker,
	});

	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	let response: { indexerId: number; candidates: Candidate[] }[];
	try {
		response = await searchTorznab(searchee.name);
	} catch (e) {
		logger.error(`error searching for ${searchee.name}`);
		logger.debug(e);
		return 0;
	}

	const results: Candidate[] = response.flatMap((e) =>
		e.candidates.map((candidate) => ({
			...candidate,
			indexerId: e.indexerId,
		}))
	);

	const assessed = await Promise.all<AssessmentWithTracker>(
		results.map(assessEach)
	);

	const { rateLimited, notRateLimited } = assessed.reduce(
		(acc, cur, idx) => {
			const candidate = results[idx];
			if (cur.assessment.decision === Decision.RATE_LIMITED) {
				acc.rateLimited.add(candidate.indexerId);
				acc.notRateLimited.delete(candidate.indexerId);
			}
			return acc;
		},
		{
			rateLimited: new Set<number>(),
			notRateLimited: new Set(response.map((r) => r.indexerId)),
		}
	);

	await updateSearchTimestamps(searchee.name, Array.from(notRateLimited));

	await updateIndexerStatus(
		IndexerStatus.RATE_LIMITED,
		Date.now() + ms("1 hour"),
		Array.from(rateLimited)
	);

	const matches = assessed.filter(
		(e) =>
			e.assessment.decision === Decision.MATCH ||
			e.assessment.decision === Decision.MATCH_SIZE_ONLY
	);
	const actionResults = await performActions(searchee, matches, nonceOptions);

	if (!actionResults.includes(InjectionResult.TORRENT_NOT_COMPLETE)) {
		const zipped: [ResultAssessment, string, ActionResult][] = zip(
			matches.map((m) => m.assessment),
			matches.map((m) => m.tracker),
			actionResults
		);
		sendResultsNotification(searchee, zipped, Label.SEARCH);
	}
	return matches.length;
}

async function findMatchesBatch(
	samples: Searchee[],
	hashesToExclude: string[]
) {
	const { delay } = getRuntimeConfig();

	let totalFound = 0;
	for (const [i, sample] of samples.entries()) {
		const sleep = new Promise((r) => setTimeout(r, delay * 1000));

		const progress = chalk.blue(`[${i + 1}/${samples.length}]`);
		const name = stripExtension(sample.name);
		logger.info("%s %s %s", progress, chalk.dim("Searching for"), name);

		const numFoundPromise = findOnOtherSites(sample, hashesToExclude);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	return totalFound;
}

export async function searchForLocalTorrentByCriteria(
	criteria: TorrentLocator,
	nonceOptions: NonceOptions
): Promise<number> {
	const { maxDataDepth } = getRuntimeConfig();

	let metafiles;
	if (criteria.path) {
		const searcheeResults = await Promise.all(
			findPotentialNestedRoots(criteria.path, maxDataDepth).map(
				createSearcheeFromPath
			)
		);
		metafiles = searcheeResults.map((t) => t.unwrapOrThrow());
	} else {
		metafiles = [await getTorrentByCriteria(criteria)];
	}
	const hashesToExclude = await getInfoHashesToExclude();
	let matches = 0;
	for (let i = 0; i < metafiles.length; i++) {
		if (!filterByContent(metafiles[i])) return null;
		matches += await findOnOtherSites(
			metafiles[i],
			hashesToExclude,
			nonceOptions
		);
	}
	return matches;
}

export async function checkNewCandidateMatch(
	candidate: Candidate
): Promise<boolean> {
	const meta = await getTorrentByFuzzyName(candidate.name);
	if (meta === null) {
		logger.verbose({
			label: Label.REVERSE_LOOKUP,
			message: `Did not find an existing entry for ${candidate.name}`,
		});
		return false;
	}

	const hashesToExclude = await getInfoHashesToExclude();
	if (!filterByContent(meta)) return false;
	const searchee = createSearcheeFromMetafile(meta);

	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	const assessment: ResultAssessment = await assessCandidate(
		candidate,
		searchee,
		hashesToExclude
	);

	if (
		assessment.decision !== Decision.MATCH &&
		assessment.decision !== Decision.MATCH_SIZE_ONLY
	)
		return false;

	const result = await performAction(
		assessment.metafile,
		assessment.decision,
		searchee,
		candidate.tracker,
		EmptyNonceOptions
	);
	await sendResultsNotification(
		searchee,
		[[assessment, candidate.tracker, result]],
		Label.REVERSE_LOOKUP
	);
	return result === InjectionResult.SUCCESS || result === SaveResult.SAVED;
}

async function findSearchableTorrents() {
	const { torrents, dataDirs } = getRuntimeConfig();
	let parsedTorrents: Searchee[];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile) //also create searchee from path
		);
		parsedTorrents = searcheeResults
			.filter((t) => t.isOk())
			.map((t) => t.unwrapOrThrow());
	} else if (dataDirs && dataDirs.length > 0) {
		const searcheeResults = await Promise.all(
			findSearcheesFromAllDataDirs().map(createSearcheeFromPath)
		);
		parsedTorrents = searcheeResults
			.filter((t) => t.isOk())
			.map((t) => t.unwrapOrThrow());
	} else {
		parsedTorrents = await loadTorrentDirLight();
	}

	const hashesToExclude = parsedTorrents
		.map((t) => t.infoHash)
		.filter(Boolean);
	const filteredTorrents = await filterAsync(
		filterDupes(parsedTorrents).filter(filterByContent),
		filterTimestamps
	);

	logger.info({
		label: Label.SEARCH,
		message: `Found ${parsedTorrents.length} torrents, ${filteredTorrents.length} suitable to search for matches`,
	});

	return { samples: filteredTorrents, hashesToExclude };
}

export async function main(): Promise<void> {
	const { outputDir, linkDir } = getRuntimeConfig();
	const { samples, hashesToExclude } = await findSearchableTorrents();

	fs.mkdirSync(outputDir, { recursive: true });
	if (linkDir) {
		fs.mkdirSync(linkDir, { recursive: true });
	}
	const totalFound = await findMatchesBatch(samples, hashesToExclude);

	logger.info({
		label: Label.SEARCH,
		message: chalk.cyan(
			`Found ${chalk.bold.white(
				totalFound
			)} cross seeds from ${chalk.bold.white(
				samples.length
			)} original torrents`
		),
	});
}

export async function scanRssFeeds() {
	const candidates = await queryRssFeeds();
	const lastRun =
		(await db("job_log").select("last_run").where({ name: "rss" }).first())
			?.last_run ?? 0;
	const candidatesSinceLastTime = candidates.filter(
		(c) => c.pubDate > lastRun
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
