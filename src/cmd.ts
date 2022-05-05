#!/usr/bin/env node
import chalk from "chalk";
import { Option, program } from "commander";
import { createRequire } from "module";
import { inspect } from "util";
import { generateConfig, getFileConfig } from "./configuration.js";
import { Action } from "./constants.js";
import { jobsLoop } from "./cron.js";
import { diffCmd } from "./diff.js";
import { CrossSeedError, exitOnCrossSeedErrors } from "./errors.js";
import { initializeLogger, Label, logger } from "./logger.js";
import { main } from "./pipeline.js";
import {
	initializePushNotifier,
	sendTestNotification,
} from "./pushNotifier.js";
import { setRuntimeConfig } from "./runtimeConfig.js";
import { createSearcheeFromMetafile } from "./searchee.js";
import { serve } from "./server.js";
import "./signalHandlers.js";
import { db } from "./db.js";
import { doStartupValidation } from "./startup.js";
import { parseTorrentFromFilename } from "./torrent.js";
const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

function fallback(...args) {
	for (const arg of args) {
		if (arg !== undefined) return arg;
	}
	return undefined;
}

function processOptions(options) {
	options.trackers = options.trackers?.split(",").filter((e) => e !== "");
	return options;
}

const fileConfig = await getFileConfig();

function createCommandWithSharedOptions(name, description) {
	return program
		.command(name)
		.description(description)
		.option(
			"-u, --jackett-server-url <url>",
			"DEPRECATED: Your Jackett server url",
			fileConfig.jackettServerUrl
		)
		.option(
			"-k, --jackett-api-key <key>",
			"DEPRECATED: Your Jackett API key",
			fileConfig.jackettApiKey
		)
		.option(
			"-t, --trackers <tracker1>,<tracker2>",
			"DEPRECATED: Comma-separated list of Jackett tracker ids to search  (Tracker ids can be found in their Torznab feed paths)",
			fallback(fileConfig.trackers?.join(","), "")
		)
		.option(
			"-T, --torznab <urls...>",
			"Torznab urls with apikey included (separated by spaces)",
			fallback(fileConfig.torznab)
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
		.option(
			"-e, --include-episodes",
			"Include single-episode torrents in the search",
			fallback(fileConfig.includeEpisodes, false)
		)
		.requiredOption(
			"--fuzzy-size-threshold <decimal>",
			"The size difference allowed to be considered a match.",
			fallback(fileConfig.fuzzySizeThreshold, 0.02)
		)
		.option(
			"-x, --exclude-older <cutoff>",
			"Exclude torrents first seen more than n minutes ago. Bypasses the -a flag.",
			(n) => parseInt(n),
			fileConfig.excludeOlder
		)
		.option(
			"-r, --exclude-recent-search <cutoff>",
			"Exclude torrents which have been searched more recently than n minutes ago. Bypasses the -a flag.",
			(n) => parseInt(n),
			fileConfig.excludeRecentSearch
		)
		.requiredOption("-v, --verbose", "Log verbose output", false)
		.addOption(
			new Option(
				"-A, --action <action>",
				"If set to 'inject', cross-seed will attempt to add the found torrents to your torrent client."
			)
				.default(fallback(fileConfig.action, Action.SAVE))
				.choices(Object.values(Action))
				.makeOptionMandatory()
		)
		.option(
			"--rtorrent-rpc-url <url>",
			"The url of your rtorrent XMLRPC interface. Requires '-A inject'. See the docs for more information.",
			fileConfig.rtorrentRpcUrl
		)
		.option(
			"--qbittorrent-url <url>",
			"The url of your qBittorrent webui. Requires '-A inject'. See the docs for more information.",
			fileConfig.qbittorrentUrl
		)
		.option(
			"--notification-webhook-url <url>",
			"cross-seed will send POST requests to this url with a JSON payload of { title, body }",
			fileConfig.notificationWebhookUrl
		)
		.requiredOption(
			"-d, --delay <delay>",
			"Pause duration (seconds) between searches",
			parseFloat,
			fallback(fileConfig.delay, 10)
		);
}

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
	.action((options) => {
		generateConfig(options);
	});

program
	.command("clear-cache")
	.description("Clear the cache of downloaded-and-rejected torrents")
	.action(async () => {
		await db("decision").del();
	});

program
	.command("test-notification")
	.description("Send a test notification")
	.requiredOption(
		"--notification-webhook-url <url>",
		"cross-seed will send POST requests to this url with a JSON payload of { title, body }",
		fileConfig.notificationWebhookUrl
	)
	.action((options) => {
		setRuntimeConfig(options);
		initializeLogger();
		initializePushNotifier();
		sendTestNotification();
	});

program
	.command("diff")
	.description("Analyze two torrent files for cross-seed compatibility")
	.argument("searchee")
	.argument("candidate")
	.action(diffCmd);

program
	.command("tree")
	.description("Print a torrent's file tree")
	.argument("torrent")
	.action(async (fn) => {
		console.log(
			createSearcheeFromMetafile(await parseTorrentFromFilename(fn))
		);
	});

createCommandWithSharedOptions("daemon", "Start the cross-seed daemon")
	.option(
		"-p, --port <port>",
		"Listen on a custom port",
		(n) => parseInt(n),
		fallback(fileConfig.port, 2468)
	)
	.action(async (options) => {
		try {
			const runtimeConfig = processOptions(options);
			setRuntimeConfig(runtimeConfig);
			initializeLogger();
			initializePushNotifier();
			logger.verbose({
				label: Label.CONFIGDUMP,
				message: inspect(runtimeConfig),
			});
			if (process.env.DOCKER_ENV === "true") {
				generateConfig({ docker: true });
			}
			await db.migrate.latest();
			await doStartupValidation();
			serve(options.port);
			jobsLoop();
		} catch (e) {
			if (e instanceof CrossSeedError) {
				e.print();
				process.exitCode = 1;
				return;
			}
			throw e;
		}
	});

createCommandWithSharedOptions("search", "Search for cross-seeds")
	.addOption(
		new Option(
			"--torrents <torrents...>",
			"torrent files separated by spaces. This is a debug option and may be removed without warning."
		).hideHelp()
	)
	.action(async (options) => {
		try {
			const runtimeConfig = processOptions(options);
			setRuntimeConfig(runtimeConfig);
			initializeLogger();
			initializePushNotifier();
			logger.verbose({
				label: Label.CONFIGDUMP,
				message: inspect(runtimeConfig),
			});
			if (process.env.DOCKER_ENV === "true") {
				generateConfig({ docker: true });
			}

			await db.migrate.latest();
			await doStartupValidation();
			await main();
			await db.destroy();
		} catch (e) {
			exitOnCrossSeedErrors(e);
		}
	});

await program.parseAsync();
