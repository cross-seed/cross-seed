import chalk from "chalk";
import fs from "fs";
import { zip } from "lodash-es";
import path from "path";
import { performAction, performActions } from "./action.js";
import {
	ActionResult,
	Decision,
	InjectionResult,
	SaveResult,
} from "./constants.js";
import { db } from "./db.js";
import { assessCandidate, ResultAssessment } from "./decide.js";
import { Label, logger } from "./logger.js";
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import {
	EmptyNonceOptions,
	getRuntimeConfig,
	NonceOptions,
} from "./runtimeConfig.js";
import {
	getFilePathsFromPath,
	createSearcheeFromMetafile,
	createSearcheeFromTorrentFile,
	createSearcheeFromPath,
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
import { getTorznabManager } from "./torznab.js";
import { filterAsync, ok, stripExtension } from "./utils.js";

export interface Candidate {
	guid: string;
	link: string;
	size: number;
	name: string;
	tracker: string;
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

	const query = stripExtension(searchee.name);

	// make sure searchee is in database
	await db("searchee")
		.insert({ name: searchee.name })
		.onConflict("name")
		.ignore();

	let response: Candidate[];
	try {
		response = await getTorznabManager().searchTorznab(query, nonceOptions);
	} catch (e) {
		logger.error(`error searching for ${query}`);
		return 0;
	}
	const results = response;

	const loaded = await Promise.all<AssessmentWithTracker>(
		results.map(assessEach)
	);
	const matches = loaded.filter(
		(e) => (e.assessment.decision === Decision.MATCH || 
			    e.assessment.decision === Decision.MATCH_EXCEPT_PARENT_DIR)
	);
	const actionResults = await performActions(searchee, matches, nonceOptions);

	if (!actionResults.includes(InjectionResult.TORRENT_NOT_COMPLETE)) {
		const zipped: [ResultAssessment, string, ActionResult][] = zip(
			matches.map((m) => m.assessment),
			matches.map((m) => m.tracker),
			actionResults
		);
		sendResultsNotification(searchee, zipped, Label.SEARCH);
		await updateSearchTimestamps(searchee.name);
	}
	return matches.length;
}

async function updateSearchTimestamps(name: string): Promise<void> {
	await db.transaction(async (trx) => {
		const now = Date.now();
		const entry = await trx("searchee").where({ name }).first();

		await trx("searchee")
			.where({ name })
			.update({
				last_searched: now,
				first_searched: entry?.first_searched ? undefined : now,
			});
	});
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
	const meta = await getTorrentByCriteria(criteria);
	const hashesToExclude = await getInfoHashesToExclude();
	if (!filterByContent(meta)) return null;
	return findOnOtherSites(meta, hashesToExclude, nonceOptions);
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

	if (assessment.decision !== Decision.MATCH && assessment.decision !== Decision.MATCH_EXCEPT_PARENT_DIR) return false;

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
	const { torrents, dataDirs, dataMode } = getRuntimeConfig();
	let parsedTorrents: Searchee[];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile) //also create searchee from path
		);
		parsedTorrents = searcheeResults.filter(ok);
	} else if (dataDirs.length > 0) {
		var fullPaths: string[] = [];
		dataDirs.forEach(dataDir => {
            const allPaths = getFilePathsFromPath(dataDir, [], 0, 4);
            fullPaths = fullPaths.concat(allPaths.filter(file => 
                fs.statSync(file).isDirectory() || 
                ([".mkv", ".avi", ".mp4", ".ts", ".flac", ".mp3"].includes(path.extname(file))  // try to avoid searching for a RARed pieces
                && fs.statSync(file).size > 100000000))); //100 MB to start)
        });
		const searcheeResults = await Promise.all(fullPaths.map(createSearcheeFromPath))
		parsedTorrents = searcheeResults.filter(ok);
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
	const { outputDir, dataDirs } = getRuntimeConfig();
	const { samples, hashesToExclude } =  await findSearchableTorrents();


	fs.mkdirSync(outputDir, { recursive: true });
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
	const candidates = await getTorznabManager().searchTorznab("");
	logger.verbose({
		label: Label.RSS,
		message: `Scan returned ${candidates.length} results`,
	});
	logger.verbose({
		label: Label.RSS,
		message: "Indexing new torrents...",
	});
	await indexNewTorrents();
	for (const [i, candidate] of candidates.entries()) {
		logger.verbose({
			label: Label.RSS,
			message: `Processing release ${i + 1}/${candidates.length}`,
		});
		await checkNewCandidateMatch(candidate);
	}
	logger.info({ label: Label.RSS, message: "Scan complete" });
}
