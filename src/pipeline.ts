import chalk from "chalk";
import fs from "fs";
import { Metafile } from "parse-torrent";
import { getClient } from "./clients/TorrentClient";
import { Action, Decision, InjectionResult, TORRENTS } from "./constants";
import db from "./db";
import {
	assessResult,
	ResultAssessment,
	SuccessfulResultAssessment,
} from "./decide";
import { JackettResponse, makeJackettRequest } from "./jackett";
import * as logger from "./logger";
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter";
import { getRuntimeConfig } from "./runtimeConfig";
import {
	getInfoHashesToExclude,
	getTorrentByName,
	loadTorrentDir,
	saveTorrentFile,
} from "./torrent";
import { stripExtension } from "./utils";

async function findOnOtherSites(
	info: Metafile,
	hashesToExclude: string[]
): Promise<number> {
	const { action } = getRuntimeConfig();

	const assessEach = (result) => assessResult(result, info, hashesToExclude);

	const query = stripExtension(info.name);
	let response: JackettResponse;
	try {
		response = await makeJackettRequest(query);
	} catch (e) {
		logger.error(`error querying Jackett for ${query}`);
		return 0;
	}
	updateSearchTimestamps(info.infoHash);
	const results = response.Results;

	const loaded = await Promise.all<ResultAssessment>(results.map(assessEach));
	const successful = loaded.filter(
		(e) => e.decision === Decision.MATCH
	) as SuccessfulResultAssessment[];

	for (const { tracker, tag, info: newInfo } of successful) {
		const styledName = chalk.green.bold(newInfo.name);
		const styledTracker = chalk.bold(tracker);
		logger.log(`Found ${styledName} on ${styledTracker}`);
		if (action === Action.INJECT) {
			const result = await getClient().inject(newInfo, info);
			switch (result) {
				case InjectionResult.SUCCESS:
					logger.log(
						`Injected ${styledName} from ${styledTracker} into rTorrent.`
					);
					break;
				case InjectionResult.ALREADY_EXISTS:
					logger.log(
						`Did not inject ${styledName} because it already exists.`
					);
					break;
				case InjectionResult.FAILURE:
				default:
					logger.error(
						`Failed to inject ${styledName} from ${styledTracker} into rtorrent. Saving instead.`
					);
					saveTorrentFile(tracker, tag, newInfo);
					break;
			}
		} else {
			saveTorrentFile(tracker, tag, newInfo);
		}
	}

	return successful.length;
}

function updateSearchTimestamps(infoHash: string): void {
	db.get(TORRENTS)
		.defaultsDeep({
			[infoHash]: {
				firstSearched: Date.now(),
			},
		})
		.set([infoHash, "lastSearched"], Date.now())
		.write();
}

async function findMatchesBatch(samples, hashesToExclude) {
	const { delay, offset } = getRuntimeConfig();

	let totalFound = 0;
	for (const [i, sample] of samples.entries()) {
		const sleep = new Promise((r) => setTimeout(r, delay * 1000));

		const progress = chalk.blue(
			`[${i + 1 + offset}/${samples.length + offset}]`
		);
		const name = stripExtension(sample.name);
		logger.log(progress, chalk.dim("Searching for"), name);

		const numFoundPromise = findOnOtherSites(sample, hashesToExclude);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	return totalFound;
}

export async function searchForSingleTorrentByName(
	name: string
): Promise<number> {
	const hashesToExclude = getInfoHashesToExclude();
	const meta = getTorrentByName(name);
	if (!filterByContent(meta)) return null;
	return findOnOtherSites(meta, hashesToExclude);
}

export async function main(): Promise<void> {
	const { offset, outputDir } = getRuntimeConfig();
	const parsedTorrents = loadTorrentDir();
	const hashesToExclude = parsedTorrents.map((t) => t.infoHash);
	const filteredTorrents = filterDupes(parsedTorrents)
		.filter(filterByContent)
		.filter(filterTimestamps);
	const samples = filteredTorrents.slice(offset);

	logger.log(
		"Found %d torrents, %d suitable to search for matches",
		parsedTorrents.length,
		filteredTorrents.length
	);

	if (offset > 0) logger.log("Starting at", offset);

	fs.mkdirSync(outputDir, { recursive: true });
	const totalFound = await findMatchesBatch(samples, hashesToExclude);

	logger.log(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}
