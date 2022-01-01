import chalk from "chalk";
import fs from "fs";
import { getClient } from "./clients/TorrentClient.js";
import { Action, Decision, InjectionResult } from "./constants.js";
import db from "./db.js";
import { assessResult, ResultAssessment } from "./decide.js";
import {
	JackettResponse,
	SearchResult,
	makeJackettRequest,
} from "./jackett.js";
import { logger } from "./logger.js";
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { pushNotifier } from "./pushNotifier.js";
import {
	EmptyNonceOptions,
	getRuntimeConfig,
	NonceOptions,
} from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import {
	TorrentLocator,
	getInfoHashesToExclude,
	getTorrentByCriteria,
	loadTorrentDirLight,
	saveTorrentFile,
} from "./torrent.js";

import { getTag, stripExtension } from "./utils.js";

export interface SearchResult {
	guid: string;
	link: string;
	size: number;
	title: string;
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
	const { action } = getRuntimeConfig();

	const assessEach = async (
		result: SearchResult
	): Promise<AssessmentWithTracker> => ({
		assessment: await assessResult(result, searchee, hashesToExclude),
		tracker: result.trackerId,
	});

	const tag = getTag(searchee.name);
	const query = stripExtension(searchee.name);
	let response: SearchResult[];
	try {
		response = await makeJackettRequest(query, nonceOptions);
	} catch (e) {
		logger.error(`error querying Jackett for ${query}`);
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
			successful.length &&
			// @ts-expect-error ListFormat totally exists in node 12
			`: ${new Intl.ListFormat("en", {
				style: "long",
				type: "conjunction",
			}).format(successful.map((s) => s.tracker))}`
		}`,
		extra: {
			infoHashes: successful.map((s) => s.assessment.info.infoHash),
			trackers: successful.map((s) => s.tracker),
		},
	});

	let isTorrentIncomplete;

	for (const {
		tracker,
		assessment: { info: newInfo },
	} of successful) {
		const styledName = chalk.green.bold(newInfo.name);
		const styledTracker = chalk.bold(tracker);
		if (action === Action.INJECT) {
			const result = await getClient().inject(
				newInfo,
				searchee,
				nonceOptions
			);
			switch (result) {
				case InjectionResult.SUCCESS:
					logger.info(
						`Found ${styledName} on ${styledTracker} - injected`
					);
					break;
				case InjectionResult.ALREADY_EXISTS:
					logger.info(
						`Found ${styledName} on ${styledTracker} - exists`
					);
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
					saveTorrentFile(tracker, tag, newInfo, nonceOptions);
					break;
			}
		} else {
			saveTorrentFile(tracker, tag, newInfo, nonceOptions);
			logger.info(`Found ${styledName} on ${styledTracker}`);
		}
	}

	if (!isTorrentIncomplete) {
		updateSearchTimestamps(searchee.name);
	}

	return successful.length;
}

function updateSearchTimestamps(name: string): void {
	if (db.data.searchees[name]) {
		db.data.searchees[name].lastSearched = Date.now();
	} else {
		db.data.searchees[name] = {
			firstSearched: Date.now(),
			lastSearched: Date.now(),
		};
	}
	db.write();
}

async function findMatchesBatch(
	samples: Searchee[],
	hashesToExclude: string[]
) {
	const { delay, offset } = getRuntimeConfig();

	let totalFound = 0;
	for (const [i, sample] of samples.entries()) {
		const sleep = new Promise((r) => setTimeout(r, delay * 1000));

		const progress = chalk.blue(
			`[${i + 1 + offset}/${samples.length + offset}]`
		);
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
	const hashesToExclude = getInfoHashesToExclude();
	if (!filterByContent(meta)) return null;
	return findOnOtherSites(meta, hashesToExclude, nonceOptions);
}

async function findSearchableTorrents() {
	const { offset } = getRuntimeConfig();
	const parsedTorrents: Searchee[] = await loadTorrentDirLight();
	const hashesToExclude = parsedTorrents
		.map((t) => t.infoHash)
		.filter(Boolean);
	const filteredTorrents = filterDupes(parsedTorrents)
		.filter(filterByContent)
		.filter(filterTimestamps);
	const samples = filteredTorrents.slice(offset);

	logger.info(
		"Found %d torrents, %d suitable to search for matches",
		parsedTorrents.length,
		filteredTorrents.length
	);

	return { samples, hashesToExclude };
}

export async function main(): Promise<void> {
	const { offset, outputDir } = getRuntimeConfig();
	const { samples, hashesToExclude } = await findSearchableTorrents();

	if (offset > 0) logger.info(`Starting at offset ${offset}`);

	fs.mkdirSync(outputDir, { recursive: true });
	const totalFound = await findMatchesBatch(samples, hashesToExclude);

	logger.info(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}
