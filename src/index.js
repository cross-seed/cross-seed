const fs = require("fs");

const chalk = require("chalk");
const { getRuntimeConfig } = require("./runtimeConfig");
const { stripExtension } = require("./utils");
const {
	loadTorrentDir,
	saveTorrentFile,
	getInfoHashesToExclude,
	getTorrentByName,
} = require("./torrent");
const {
	filterByContent,
	filterDupes,
	filterTimestamps,
} = require("./preFilter");
const { assessResult } = require("./decide");
const { makeJackettRequest, validateJackettApi } = require("./jackett");
const logger = require("./logger");
const { inject } = require("./clients/rtorrent");
const { ACTIONS } = require("./constants");
const { get, save, CACHE_NAMESPACE_TORRENTS } = require("./cache");

async function findOnOtherSites(info, hashesToExclude) {
	const { action } = getRuntimeConfig();

	const assessEach = (result) => assessResult(result, info, hashesToExclude);

	const query = stripExtension(info.name);
	let response;
	try {
		response = await makeJackettRequest(query);
	} catch (e) {
		logger.error(chalk.red`error querying Jackett for ${query}`);
		return 0;
	}
	updateSearchTimestamps(info.infoHash);
	const results = response.data.Results;

	const loaded = await Promise.all(results.map(assessEach));
	const successful = loaded.filter((e) => e !== null);

	for (const { tracker, tag, info: newInfo } of successful) {
		const styledName = chalk.green.bold(newInfo.name);
		const styledTracker = chalk.bold(tracker);
		logger.log(`Found ${styledName} on ${styledTracker}`);
		if (action === ACTIONS.INJECT) {
			let injected = await inject(newInfo, info);
			if (!injected) {
				logger.error(
					`Failed to inject ${styledName} from ${styledTracker} into rtorrent. Saving instead.`
				);
				saveTorrentFile(tracker, tag, newInfo);
			}
		} else {
			saveTorrentFile(tracker, tag, newInfo);
		}
	}

	return successful.length;
}

function updateSearchTimestamps(infoHash) {
	const existingTimestamps = get(CACHE_NAMESPACE_TORRENTS, infoHash);
	const firstSearched = existingTimestamps
		? existingTimestamps.firstSearched
		: Date.now();
	const lastSearched = Date.now();
	save(CACHE_NAMESPACE_TORRENTS, infoHash, { firstSearched, lastSearched });
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

		let numFoundPromise = findOnOtherSites(sample, hashesToExclude);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	return totalFound;
}

async function searchForSingleTorrentByName(name) {
	const hashesToExclude = getInfoHashesToExclude();
	const meta = getTorrentByName(name);
	if (!filterByContent(meta)) return null;
	return findOnOtherSites(meta, hashesToExclude);
}

async function main() {
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

	try {
		await validateJackettApi();
	} catch (e) {
		return;
	}

	if (offset > 0) logger.log("Starting at", offset);

	fs.mkdirSync(outputDir, { recursive: true });
	let totalFound = await findMatchesBatch(samples, hashesToExclude);

	logger.log(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}

module.exports = { main, searchForSingleTorrentByName };
