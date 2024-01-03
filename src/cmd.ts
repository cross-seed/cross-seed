#!/usr/bin/env node
import chalk from "chalk";
import { Option, program } from "commander";
import { getApiKeyFromDatabase, resetApiKey } from "./auth.js";
import { VALIDATION_SCHEMA, zodErrorMap } from "./configSchema.js";
import { generateConfig, getFileConfig } from "./configuration.js";
import {
	Action,
	LinkType,
	MatchMode,
	PROGRAM_NAME,
	PROGRAM_VERSION,
} from "./constants.js";
import { db } from "./db.js";
import { diffCmd } from "./diff.js";
import { CrossSeedError, exitOnCrossSeedErrors } from "./errors.js";
import { jobsLoop } from "./jobs.js";
import { Label, initializeLogger, logger } from "./logger.js";
import { main, scanRssFeeds } from "./pipeline.js";
import {
	initializePushNotifier,
	sendTestNotification,
} from "./pushNotifier.js";
import { RuntimeConfig, setRuntimeConfig } from "./runtimeConfig.js";
import { createSearcheeFromMetafile } from "./searchee.js";
import { serve } from "./server.js";
import "./signalHandlers.js";
import { doStartupValidation } from "./startup.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { fallback } from "./utils.js";
import { inspect } from "util";

const fileConfig = await getFileConfig();

/**
 * validates and sets RuntimeConfig
 * @return (the number of errors Zod encountered in the configuration)
 */

export async function validateAndSetRuntimeConfig(options: RuntimeConfig) {
	initializeLogger(options);
	logger.info(`${PROGRAM_NAME} v${PROGRAM_VERSION}`);
	logger.info("Validating your configuration...");
	try {
		options = VALIDATION_SCHEMA.parse(options, {
			errorMap: zodErrorMap,
		}) as RuntimeConfig;
	} catch (error) {
		logger.verbose({
			label: Label.CONFIGDUMP,
			message: inspect(options),
		});
		error.errors.forEach(({ path, message }) => {
			const urlPath = path[0];
			const optionLine =
				path.length === 2
					? `${path[0]} (position #${path[1] + 1})`
					: path;
			logger.error(
				`${
					path.length > 0
						? `\tOption:\t ${optionLine}`
						: "\tConfiguration:"
				}\n\t${message}\n\t(https://www.cross-seed.org/docs/basics/options${
					urlPath ? `#${urlPath}` : ""
				})\n`
			);
		});
		if (error.errors.length > 0) {
			throw new CrossSeedError(
				`\tYour configuration is invalid, please see the ${
					error.errors.length > 1 ? "errors" : "error"
				} above for details.`
			);
		}
	}

	setRuntimeConfig(options);
	initializePushNotifier();
}

/**
 * parsing and processing of CLI and config file
 */

function createCommandWithSharedOptions(name, description) {
	return program
		.command(name)
		.description(description)
		.option(
			"-T, --torznab <urls...>",
			"Torznab urls with apikey included (separated by spaces)",
			// @ts-expect-error commander supports non-string defaults
			fallback(fileConfig.torznab)
		)
		.option(
			"--data-dirs <dirs...>",
			"Directories to use if searching by data instead of torrents (separated by spaces)",
			// @ts-expect-error commander supports non-string defaults
			fallback(fileConfig.dataDirs)
		)
		.addOption(
			new Option(
				"--match-mode <mode>",
				"Safe will only download torrents with perfect matches. Risky will allow for renames and more matches, but might cause false positives"
			)
				.default(fallback(fileConfig.matchMode, MatchMode.SAFE))
				.choices(Object.values(MatchMode))
				.makeOptionMandatory()
		)
		.option(
			"--data-category <cat>",
			"Category to assign torrents from data-based matching",
			fallback(fileConfig.dataCategory, "cross-seed-data")
		)
		.option(
			"--link-dir <dir>",
			"Directory to output data-matched hardlinks to",
			fileConfig.linkDir
		)
		.addOption(
			new Option(
				"--link-type <type>",
				"Use links of this type to inject data-based matches into your client"
			)
				.default(fallback(fileConfig.linkType, LinkType.SYMLINK))
				.choices(Object.values(LinkType))
				.makeOptionMandatory()
		)
		.option(
			"--skip-recheck",
			"Skips torrent recheck upon adding to QBittorrent",
			fallback(fileConfig.skipRecheck, false)
		)
		.requiredOption(
			"--max-data-depth <depth>",
			"Max depth to look for searchees in dataDirs",
			(n) => parseInt(n),
			fallback(fileConfig.maxDataDepth, 2)
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
			"--include-non-videos",
			"Include torrents which contain non-video files",
			fallback(fileConfig.includeNonVideos, false)
		)
		.option(
			"-e, --include-episodes",
			"Include all episode torrents in the search (including from season packs)",
			fallback(fileConfig.includeEpisodes, false)
		)
		.option(
			"--include-single-episodes",
			"Include single episode torrents in the search",
			fallback(fileConfig.includeSingleEpisodes, false)
		)
		.option(
			"--no-include-non-videos",
			"Don't include torrents which contain non-videos"
		)
		.option("--no-include-episodes", "Don't include episode torrents")
		.requiredOption(
			"--fuzzy-size-threshold <decimal>",
			"The size difference allowed to be considered a match.",
			parseFloat,
			fallback(fileConfig.fuzzySizeThreshold, 0.02)
		)
		.option(
			"-x, --exclude-older <cutoff>",
			"Exclude torrents first seen more than n minutes ago. Bypasses the -a flag.",
			fileConfig.excludeOlder
		)
		.option(
			"-r, --exclude-recent-search <cutoff>",
			"Exclude torrents which have been searched more recently than n minutes ago. Bypasses the -a flag.",
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
			"--transmission-rpc-url <url>",
			"The url of your Transmission RPC interface. Requires '-A inject'. See the docs for more information.",
			fileConfig.transmissionRpcUrl
		)
		.option(
			"--deluge-rpc-url <url>",
			"The url of your Deluge JSON-RPC interface. Requires '-A inject'. See the docs for more information.",
			fileConfig.delugeRpcUrl
		)
		.option(
			"--duplicate-categories",
			"Create and inject using categories with the same save paths as your normal categories",
			fileConfig.duplicateCategories
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
		)
		.requiredOption(
			"--snatch-timeout <timeout>",
			"Timeout for unresponsive snatches",
			fallback(fileConfig.snatchTimeout, "30 seconds")
		)
		.requiredOption(
			"--search-timeout <timeout>",
			"Timeout for unresponsive searches",
			fallback(fileConfig.searchTimeout, "30 seconds")
		)
		.option(
			"--search-limit <number>",
			"The number of searches before stops",
			parseInt,
			fallback(fileConfig.searchLimit, 0)
		);
}

program.name(PROGRAM_NAME);
program.description(chalk.yellow.bold("cross-seed"));
program.version(PROGRAM_VERSION, "-V, --version", "output the current version");

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
		await db("indexer").update({
			status: null,
			retry_after: null,
			search_cap: null,
			tv_search_cap: null,
			movie_search_cap: null,
		});
		await db.destroy();
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
		initializeLogger(options);
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

program
	.command("api-key")
	.description("Show the api key")
	.action(async () => {
		await db.migrate.latest();
		console.log(await getApiKeyFromDatabase());
		await db.destroy();
	});

program
	.command("reset-api-key")
	.description("Reset the api key")
	.action(async () => {
		await db.migrate.latest();
		console.log(await resetApiKey());
		await db.destroy();
	});

createCommandWithSharedOptions("daemon", "Start the cross-seed daemon")
	.option(
		"-p, --port <port>",
		"Listen on a custom port",
		(n) => parseInt(n),
		fallback(fileConfig.port, 2468)
	)
	.option("--host <host>", "Bind to a specific IP address", fileConfig.host)
	.option(
		"--api-auth",
		"Require API auth via API key",
		fallback(fileConfig.apiAuth, false)
	)
	.option("--no-api-auth", "Don't require API auth")
	.option("--no-port", "Do not listen on any port")
	.option(
		"--search-cadence <cadence>",
		"Run searches on a schedule. Format: https://github.com/vercel/ms",
		fileConfig.searchCadence
	)
	.option(
		"--rss-cadence <cadence>",
		"Run an rss scan on a schedule. Format: https://github.com/vercel/ms",
		fileConfig.rssCadence
	)
	.action(async (options) => {
		try {
			await validateAndSetRuntimeConfig(options);
			await db.migrate.latest();
			await doStartupValidation();
			serve(options.port, options.host);
			jobsLoop();
		} catch (e) {
			exitOnCrossSeedErrors(e);
			await db.destroy();
		}
	});

createCommandWithSharedOptions("rss", "Run an rss scan").action(
	async (options) => {
		try {
			await validateAndSetRuntimeConfig(options);
			await db.migrate.latest();
			await doStartupValidation();
			await scanRssFeeds();
			await db.destroy();
		} catch (e) {
			exitOnCrossSeedErrors(e);
			await db.destroy();
		}
	}
);

createCommandWithSharedOptions("search", "Search for cross-seeds")
	.addOption(
		new Option(
			"--torrents <torrents...>",
			"torrent files separated by spaces"
		).hideHelp()
	)
	.action(async (options) => {
		try {
			await validateAndSetRuntimeConfig(options);
			await db.migrate.latest();
			await doStartupValidation();
			await main();
			await db.destroy();
		} catch (e) {
			exitOnCrossSeedErrors(e);
			await db.destroy();
		}
	});

program.showHelpAfterError("(add --help for additional information)");

await program.parseAsync();
