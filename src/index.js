const fs = require("fs");

const chalk = require("chalk");
const { loadTorrentDir, saveTorrentFile } = require("./torrent");
const { filterTorrentFile } = require("./preFilter");
const { assessResult } = require("./decide");
const { makeJackettRequest } = require("./jackett");

async function findOnOtherSites(info, hashesToExclude, config) {
	const assessEach = (result) => assessResult(result, info, hashesToExclude);

	const query = info.name.replace(/.mkv$/, "");
	const response = await makeJackettRequest(query, config);
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
		const name = sample.name.replace(/.mkv$/, "");
		console.log(progress, chalk.dim("Searching for"), name);

		let numFoundPromise = findOnOtherSites(sample, hashesToExclude, config);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	return totalFound;
}

async function main(config) {
	const { torrentDir, offset, outputDir, includeEpisodes } = config;
	const parsedTorrents = loadTorrentDir(torrentDir);
	const hashesToExclude = parsedTorrents.map((t) => t.infoHash);
	const filteredTorrents = parsedTorrents.filter((e, i, a) =>
		filterTorrentFile(e, i, a, includeEpisodes)
	);
	const samples = filteredTorrents.slice(offset);

	console.log(
		"Found %d torrents, %d suitable to search for matches",
		parsedTorrents.length,
		filteredTorrents.length
	);
	if (offset > 0) console.log("Starting at", offset);

	fs.mkdirSync(outputDir, { recursive: true });
	let totalFound = await findMatchesBatch(samples, hashesToExclude, config);

	console.log(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}

module.exports = main;
