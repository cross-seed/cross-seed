const fs = require("fs");

const chalk = require("chalk");
const { loadTorrentDir } = require("./torrent");
const { saveTorrentFile } = require("./torrent");
const { filterTorrentFile } = require("./preFilter");
const { assessResult } = require("./decide");
const { makeJackettRequest } = require("./jackett");

async function findOnOtherSites(info, hashesToExclude) {
	const response = await makeJackettRequest(info.name.replace(/.mkv$/, ""));
	const results = response.data.Results;
	const mapCb = (result) => assessResult(result, info, hashesToExclude);
	const promises = results.map(mapCb);
	const finished = await Promise.all(promises);
	const successful = finished.filter((e) => e !== null);

	successful.forEach(({ tracker, type, info: newInfo }) => {
		const styledName = chalk.green.bold(newInfo.name);
		const styledTracker = chalk.bold(tracker);
		console.log(`Found ${styledName} on ${styledTracker}`);
		saveTorrentFile(tracker, type, newInfo);
	});

	return successful.length;
}

async function main(config) {
	const parsedTorrents = loadTorrentDir(config.torrentDir);
	const hashesToExclude = parsedTorrents.map((t) => t.infoHash);
	const filteredTorrents = parsedTorrents.filter(filterTorrentFile);

	console.log(
		"Found %d torrents, %d suitable to search for matches",
		parsedTorrents.length,
		filteredTorrents.length
	);

	fs.mkdirSync(config.outputDir, { recursive: true });
	const samples = filteredTorrents.slice(config.offset);
	let totalFound = 0;
	for (const [i, sample] of samples.entries()) {
		const sleep = new Promise((r) => setTimeout(r, config.delay * 1000));
		const name = sample.name.replace(/.mkv$/, "");
		const progress = chalk.blue(`[${i + 1}/${samples.length}]`);
		console.log(progress, chalk.dim("Searching for"), name);
		let numFoundPromise = findOnOtherSites(sample, hashesToExclude);
		const [numFound] = await Promise.all([numFoundPromise, sleep]);
		totalFound += numFound;
	}
	console.log(
		chalk.cyan("Done! Found %s cross seeds from %s original torrents"),
		chalk.bold.white(totalFound),
		chalk.bold.white(samples.length)
	);
}

module.exports = main;
