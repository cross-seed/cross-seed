#!/usr/bin/env node
import chalk from "chalk";
import { Option, program } from "commander";
import packageDotJson from "../package.json";
import { generateConfig, getFileConfig } from "./configuration";
import { Action } from "./constants";
import { dropDatabase } from "./db";
import { CrossSeedError } from "./errors";
import { initializeLogger, Label, logger } from "./logger";
import { main } from "./pipeline";
import {
	initializePushNotifier,
	pushNotifier,
	sendTestNotification,
} from "./pushNotifier";
import { setRuntimeConfig } from "./runtimeConfig";
import { serve } from "./server";
import { inspect } from "util";
import "./signalHandlers";

import { doStartupValidation } from "./startup";

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

async function run() {
	const fileConfig = getFileConfig();

	function createCommandWithSharedOptions(name, description) {
		return program
			.command(name)
			.description(description)
			.requiredOption(
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
				fallback(fileConfig.trackers?.join(","), "")
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
		.action(dropDatabase);

	createCommandWithSharedOptions(
		"daemon",
		"Start the cross-seed daemon"
	).action(async (options) => {
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
			await doStartupValidation();
			await serve();
		} catch (e) {
			if (e instanceof CrossSeedError) {
				e.print();
				process.exitCode = 1;
				return;
			}
			throw e;
		}
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
			const runtimeConfig = processOptions(options);
			setRuntimeConfig(runtimeConfig);
			initializeLogger();
			initializePushNotifier();
			sendTestNotification();
		});

	createCommandWithSharedOptions("search", "Search for cross-seeds")
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
				await doStartupValidation();
				await main();
			} catch (e) {
				if (e instanceof CrossSeedError) {
					e.print();
					process.exitCode = 1;
					return;
				}
				throw e;
			}
		});
	await program.parseAsync();
}

run();
