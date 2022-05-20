import chalk from "chalk";
import fs from "fs";
import { Metafile } from "parse-torrent";
import { getClient } from "./clients/TorrentClient.js";
import { Action, Decision, InjectionResult } from "./constants.js";
import { assessCandidate, ResultAssessment } from "./decide.js";
import { Label, logger } from "./logger.js";
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { pushNotifier } from "./pushNotifier.js";
import {
	EmptyNonceOptions,
	getRuntimeConfig,
	NonceOptions,
} from "./runtimeConfig.js";
import {
	createSearcheeFromMetafile,
	createSearcheeFromTorrentFile,
	Searchee,
} from "./searchee.js";
import { db } from "./db.js";
import {
	getInfoHashesToExclude,
	getTorrentByCriteria,
	loadTorrentDirLight,
	saveTorrentFile,
	TorrentLocator,
} from "./torrent.js";
import { getTorznabManager } from "./torznab.js";
import { filterAsync, getTag, ok, stripExtension } from "./utils.js";

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

async function performAction(
	meta: Metafile,
	searchee: Searchee,
	tracker: string,
	nonceOptions: NonceOptions,
	tag: string
): Promise<{ isTorrentIncomplete: boolean }> {
	const { action } = getRuntimeConfig();

	let isTorrentIncomplete;
	const styledName = chalk.green.bold(meta.name);
	const styledTracker = chalk.bold(tracker);
	if (action === Action.INJECT) {
		const result = await getClient().inject(meta, searchee, nonceOptions);
		switch (result) {
			case InjectionResult.SUCCESS:
				logger.info(
					`Found ${styledName} on ${styledTracker} - injected`
				);
				break;
			case InjectionResult.ALREADY_EXISTS:
				logger.info(`Found ${styledName} on ${styledTracker} - exists`);
				break;
			case InjectionResult.TORRENT_NOT_COMPLETE:
				logger.warn(
					`Found ${styledName} on ${styledTracker} - skipping incomplete torrent`
				);
				isTorrentIncomplete = true;
				break;
			case InjectionResult.FAILURE:
			default:
				logger.error(
					`Found ${styledName} on ${styledTracker} - failed to inject, saving instead`
				);
				saveTorrentFile(tracker, tag, meta, nonceOptions);
				break;
		}
	} else {
		saveTorrentFile(tracker, tag, meta, nonceOptions);
		logger.info(`Found ${styledName} on ${styledTracker}`);
	}
	return { isTorrentIncomplete };
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

	const tag = getTag(searchee.name);
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
	const successful = loaded.filter(
		(e) => e.assessment.decision === Decision.MATCH
	);

	pushNotifier.notify({
		body: `Found ${searchee.name} on ${successful.length} trackers${
			successful.length
				? // @ts-expect-error ListFormat totally exists in node 12
				  `: ${new Intl.ListFormat("en", {
						style: "long",
						type: "conjunction",
				  }).format(successful.map((s) => s.tracker))}`
				: ""
		}`,
		extra: {
			infoHashes: successful.map((s) => s.assessment.metafile.infoHash),
			trackers: successful.map((s) => s.tracker),
		},
	});

	for (const { tracker, assessment } of successful) {
		const { isTorrentIncomplete } = await performAction(
			assessment.metafile,
			searchee,
			tracker,
			nonceOptions,
			tag
		);
		if (isTorrentIncomplete) return successful.length;
	}

	await updateSearchTimestamps(searchee.name);
	return successful.length;
}

async function updateSearchTimestamps(name: string): Promise<void> {
	await db.transaction(async (trx) => {
		const now = Date.now();
		const entry = await trx("searchee").where({ name }).first();

		await trx("searchee")
			.where({ name })
			.update({
				last_searched: now,
				first_searched: entry ? undefined : now,
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
	let meta;
	try {
		meta = await getTorrentByCriteria({ name: candidate.name });
	} catch (e) {
		logger.verbose({
			label: Label.SERVER,
			message: `Did not find an existing entry for ${candidate.name}`,
		});
		return false;
	}
	const hashesToExclude = await getInfoHashesToExclude();
	if (!filterByContent(meta)) return false;
	const searchee = createSearcheeFromMetafile(meta);
	const assessment: ResultAssessment = await assessCandidate(
		candidate,
		searchee,
		hashesToExclude
	);

	if (assessment.decision !== Decision.MATCH) return false;

	const { isTorrentIncomplete } = await performAction(
		meta,
		searchee,
		candidate.tracker,
		EmptyNonceOptions,
		getTag(candidate.name)
	);
	return !isTorrentIncomplete;
}

async function findSearchableTorrents() {
	const { torrents } = getRuntimeConfig();
	let parsedTorrents: Searchee[];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile)
		);
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
	const { outputDir } = getRuntimeConfig();
	const { samples, hashesToExclude } = await findSearchableTorrents();

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
	const candidates = await searchJackettOrTorznab("");
	logger.verbose({
		label: Label.RSS,
		message: `Scan returned ${candidates.length} results`,
	});
	for (const candidate of candidates) {
		await checkNewCandidateMatch(candidate);
	}
	logger.info({ label: Label.RSS, message: "Scan complete" });
}
