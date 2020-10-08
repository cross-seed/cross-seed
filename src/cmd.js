#!/usr/bin/env node

const { program, Command } = require("commander");
const chalk = require("chalk");
const packageDotJson = require("../package.json");
const { main } = require("./index");
const { CONFIG, generateConfig } = require("./configuration");
const { clear: clearCache } = require("./cache");
const { serve } = require("./server");

function addSharedOptions() {
	return this.requiredOption(
		"-u, --jackett-server-url <url>",
		"Your Jackett server url",
		CONFIG.jackettServerUrl
	)
		.requiredOption(
			"-k, --jackett-api-key <key>",
			"Your Jackett API key",
			CONFIG.jackettApiKey
		)
		.requiredOption(
			"-t, --trackers <tracker>",
			"Comma-separated list of Jackett tracker ids to search",
			CONFIG.trackers && CONFIG.trackers.join(",")
		)
		.requiredOption(
			"-i, --torrent-dir <dir>",
			"Directory with torrent files",
			CONFIG.torrentDir
		)
		.requiredOption(
			"-s, --output-dir <dir>",
			"Directory to save results in",
			CONFIG.outputDir
		);
}
// monkey patch Command with this addSharedOptions function
Command.prototype.addSharedOptions = addSharedOptions;

program.name(packageDotJson.name);
program.description(chalk.yellow.bold("cross-seed"));
program.version(
	packageDotJson.version,
	"-v, --version",
	"output the current version"
);

program
	.command("gen-config")
	.description("Generate a config file")
	.option(
		"-d, --docker",
		"Generate the docker config instead of the normal one"
	)
	.action((command) => {
		const options = command.opts();
		generateConfig(options);
	});

program
	.command("clear-cache")
	.description("Clear the cache of downloaded-and-rejected torrents")
	.action(clearCache);

program
	.command("daemon")
	.description("Start the cross-serve daemon")
	.addSharedOptions()
	.action(async (command) => {
		const options = command.opts();
		options.trackers = options.trackers.split(",").filter((e) => e !== "");
		try {
			await serve(options);
		} catch (e) {
			console.error(chalk.bold.red(e.message));
		}
	});

program
	.command("search")
	.description("Search for cross-seeds\n")
	.addSharedOptions()
	.requiredOption(
		"-o, --offset <offset>",
		"Offset to start from",
		(n) => parseInt(n),
		CONFIG.offset || 0
	)
	.requiredOption(
		"-d, --delay <delay>",
		"Pause duration (seconds) between searches",
		parseFloat,
		CONFIG.delay || 10
	)
	.option(
		"-e, --include-episodes",
		"Include single-episode torrents in the search",
		CONFIG.includeEpisodes || false
	)
	.action(async (command) => {
		const options = command.opts();
		options.trackers = options.trackers.split(",").filter((e) => e !== "");
		try {
			await main(options);
		} catch (e) {
			console.error(chalk.bold.red(e.message));
		}
	});

program.parse();
