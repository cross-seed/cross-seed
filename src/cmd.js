#!/usr/bin/env node

const { program, Command, Option } = require("commander");
const chalk = require("chalk");
const packageDotJson = require("../package.json");
const { main } = require("./index");
const { generateConfig, getFileConfig } = require("./configuration");
const { setRuntimeConfig } = require("./runtimeConfig");
const { clear: clearCache } = require("./cache");
const { serve } = require("./server");
const logger = require("./logger");
require("./signalHandlers");
const { CrossSeedError } = require("./errors");
const { ACTIONS } = require("./constants");

async function run() {
	const fileConfig = getFileConfig();

	function fallback(...args) {
		for (const arg of args) {
			if (arg !== undefined) return arg;
		}
		return undefined;
	}

	function processOptions(options) {
		options.trackers = options.trackers.split(",").filter((e) => e !== "");
		if (options.action === "inject" && !options.rtorrentRpcUrl) {
			throw new CrossSeedError(
				"You need to specify --rtorrent-rpc-url when using '-A inject'."
			);
		}
		return options;
	}

	function addSharedOptions() {
		return this.requiredOption(
			"-u, --jackett-server-url <url>",
			"Your Jackett server url",
			fileConfig.jackettServerUrl
		)
			.requiredOption(
				"-k, --jackett-api-key <key>",
				"Your Jackett API key",
				fileConfig.jackettApiKey
			)
			.requiredOption(
				"-t, --trackers <tracker1>,<tracker2>",
				"Comma-separated list of Jackett tracker ids to search  (Tracker ids can be found in their Torznab feed paths)",
				fallback(
					fileConfig.trackers && fileConfig.trackers.join(","),
					""
				)
			)
			.requiredOption(
				"-i, --torrent-dir <dir>",
				"Directory with torrent files",
				fileConfig.torrentDir
			)
			.requiredOption(
				"-s, --output-dir <dir>",
				"Directory to save results in",
				fileConfig.outputDir
			)
			.requiredOption(
				"-a, --search-all",
				"Search for all torrents regardless of their contents",
				fallback(fileConfig.searchAll, false)
			)
			.requiredOption("-v, --verbose", "Log verbose output", false)
			.addOption(
				new Option(
					"-A, --action <action>",
					"If set to 'inject', cross-seed will attempt to add the found torrents to your torrent client."
				)
					.default(fallback(fileConfig.action, ACTIONS.SAVE))
					.choices(Object.values(ACTIONS))
					.makeOptionMandatory()
			)
			.option(
				"--rtorrent-rpc-url <url>",
				"The url of your rtorrent XMLRPC interface. Requires '-A inject'. See the docs for more information.",
				fileConfig.rtorrentRpcUrl
			);
	}

	// monkey patch Command with this addSharedOptions function
	Command.prototype.addSharedOptions = addSharedOptions;

	program.name(packageDotJson.name);
	program.description(chalk.yellow.bold("cross-seed"));
	program.version(
		packageDotJson.version,
		"-V, --version",
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
		.action(async (options, _command) => {
			setRuntimeConfig(processOptions(options));
			try {
				if (process.env.DOCKER_ENV === "true") {
					generateConfig({ docker: true });
				}
				await serve();
			} catch (e) {
				logger.error(chalk.bold.red(e.message));
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
			0
		)
		.requiredOption(
			"-d, --delay <delay>",
			"Pause duration (seconds) between searches",
			parseFloat,
			fallback(fileConfig.delay, 10)
		)
		.option(
			"-e, --include-episodes",
			"Include single-episode torrents in the search",
			fallback(fileConfig.includeEpisodes, false)
		)
		.option(
			"-x, --exclude-older <cutoff>",
			"Exclude torrents first seen more than x minutes ago. Overrides the -a flag.",
			(n) => parseInt(n)
		)
		.option(
			"-r, --exclude-recent-search <cutoff>",
			"Exclude torrents which have been searched more recently than x minutes ago. Overrides the -a flag.",
			(n) => parseInt(n)
		)
		.action(async (options, _command) => {
			setRuntimeConfig(processOptions(options));
			await main();
		});
	await program.parseAsync();
}

if (require.main === module) {
	run().catch((e) => {
		logger.error(e);
	});
}

module.exports = { run };
