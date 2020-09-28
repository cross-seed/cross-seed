const fs = require("fs");

const chalk = require("chalk");
const { stripExtension } = require("./utils");
const {
	loadTorrentDir,
	saveTorrentFile,
	getInfoHashesToExclude,
	getTorrentByName,
} = require("./torrent");
const { filterTorrentFile, filterDupes } = require("./preFilter");
const { assessResult } = require("./decide");
const { makeJackettRequest, validateJackettApi } = require("./jackett");

async function findOnOtherSites(info, hashesToExclude, config) {
	const assessEach = (result) => assessResult(result, info, hashesToExclude);

	const query = stripExtension(info.name);
	let response;
	try {
		response = await makeJackettRequest(query, config);
	} catch (e) {
		console.error(chalk.red`error querying Jackett for ${query}`);
		return 0;
	}
	const results = response.data.Results;

	const loaded = await Promise.all(results.map(assessEach));
	const successful = loaded.filter((e) => e !== null);

	successful.forEach(({ tracker, tag, info: newInfo }) => {
		const styledName = chalk.green.bold(newInfo.name);
		const styledTracker = chalk.bold(tracker);
		console.log(`Found ${styledName} on ${styledTracker}`);
		saveTorrentFile(tracker, tag, newInfo, config.outputDir);
	});

	return successful.length;
}

async function findMatchesBatch(samples, hashesToExclude, config) {
	let totalFound = 0;

	for (const [i, sample] of samples.entries()) {
		const sleep = new Promise((r) => setTimeout(r, config.delay * 1000));

		const progress = chalk.blue(`[${i + 1}/${samples.length}]`);
		const name = stripExtension(sample.name);
		console.log(progress, chalk.dim("Searching for"), name);

		let numFoundPromise = findOnOtherSites(sample, hashesToExclude, config);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	return totalFound;
}

async function searchForSingleTorrentByName(name, config) {
	const { torrentDir } = config;
	const hashesToExclude = getInfoHashesToExclude(torrentDir);
	const meta = getTorrentByName(torrentDir, name);
	console.log(meta);
	return findOnOtherSites(meta, hashesToExclude, config);
}

async function main(config) {
	const { torrentDir, offset, outputDir, includeEpisodes } = config;
	const parsedTorrents = loadTorrentDir(torrentDir);
	const hashesToExclude = parsedTorrents.map((t) => t.infoHash);
	const filteredTorrents = filterDupes(parsedTorrents).filter(
		filterTorrentFile(includeEpisodes)
	);
	const samples = filteredTorrents.slice(offset);

	console.log(
		"Found %d torrents, %d suitable to search for matches",
		parsedTorrents.length,
		filteredTorrents.length
	);

	try {
		await validateJackettApi(config);
	} catch (e) {
		return;
	}

	if (offset > 0) console.log("Starting at", offset);

	fs.mkdirSync(outputDir, { recursive: true });
	let totalFound = await findMatchesBatch(samples, hashesToExclude, config);

	console.log(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}

module.exports = { main, searchForSingleTorrentByName };
