import { getClient } from "./clients/TorrentClient.js";
import { getFileConfig } from "./configuration.js";
import { MatchMode, Action } from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { validateTorznabUrls } from "./torznab.js";
import { VALIDATION_SCHEMA } from "./zod.js";
const fileConfig = await getFileConfig();

function validateOptions() {
	const {
		action,
		rtorrentRpcUrl,
		qbittorrentUrl,
		transmissionRpcUrl,
		delugeRpcUrl,
		dataDirs,
		linkDir,
		matchMode,
		skipRecheck,
	} = getRuntimeConfig();
	if (
		action === "inject" &&
		!(
			rtorrentRpcUrl ||
			qbittorrentUrl ||
			transmissionRpcUrl ||
			delugeRpcUrl
		)
	) {
		throw new CrossSeedError(
			"You need to specify --rtorrent-rpc-url, --transmission-rpc-url, --qbittorrent-url, or --deluge-rpc-url when using '-A inject'."
		);
	}
	if ((dataDirs && !linkDir) || (!dataDirs && linkDir)) {
		throw new CrossSeedError(
			"Data based matching requires both --link-dir and --data-dirs"
		);
	}
	if (matchMode == MatchMode.RISKY && skipRecheck) {
		logger.warn(
			"It is strongly recommended to not skip rechecking for risky matching mode"
		);
	}
}

export async function validateWithZod() {
	const {
		action,
		rtorrentRpcUrl,
		qbittorrentUrl,
		transmissionRpcUrl,
		dataDirs,
		outputDir,
		torrentDir,
		dataCategory,
		linkDir,
		notificationWebhookUrl,
		linkType,
		matchMode,
		skipRecheck,
		fuzzySizeThreshold,
		port,
		excludeOlder,
		excludeRecentSearch,
		rssCadence,
		searchCadence,
		searchLimit,
		includeSingleEpisodes,
		includeEpisodes,
		includeNonVideos,
		duplicateCategories,
	} = getRuntimeConfig();
	try {
		VALIDATION_SCHEMA.ACTION.parse(action);
		if (action === Action.INJECT) {
			if (qbittorrentUrl) {
				VALIDATION_SCHEMA.URL.parse(qbittorrentUrl);
			} else if (rtorrentRpcUrl) {
				VALIDATION_SCHEMA.URL.parse(rtorrentRpcUrl);
			} else if (transmissionRpcUrl) {
				VALIDATION_SCHEMA.URL.parse(transmissionRpcUrl);
			}
		}
		const downloadClient = getClient();
		await Promise.all<void>(
			[validateTorznabUrls(), downloadClient?.validateConfig()].filter(
				Boolean
			)
		);
		if (notificationWebhookUrl) {
			VALIDATION_SCHEMA.URL.parse(notificationWebhookUrl);
		}

		if (excludeOlder) {
			VALIDATION_SCHEMA.MS.parse(excludeOlder);
		} else if (!excludeOlder && fileConfig.excludeOlder) {
			throw new Error(
				"your interval does not comply with vercel's 'ms' format"
			);
		}

		if (excludeRecentSearch) {
			VALIDATION_SCHEMA.MS.parse(excludeRecentSearch);
		} else if (!excludeRecentSearch && fileConfig.excludeRecentSearch) {
			throw new Error(
				"your interval does not comply with vercel's 'ms' format"
			);
		}
		if (rssCadence) {
			VALIDATION_SCHEMA.MS.parse(rssCadence);
		} else if (!rssCadence && fileConfig.rssCadence) {
			throw new Error(
				"your interval does not comply with vercel's 'ms' format"
			);
		}
		if (searchCadence) {
			VALIDATION_SCHEMA.MS.parse(searchCadence);
		} else if (!searchCadence && fileConfig.searchCadence) {
			throw new Error(
				"your interval does not comply with vercel's 'ms' format"
			);
		}

		VALIDATION_SCHEMA.STRING.parse(dataCategory);
		VALIDATION_SCHEMA.FUZZY.parse(fuzzySizeThreshold);
		VALIDATION_SCHEMA.PORT.parse(port);
		VALIDATION_SCHEMA.MATCHMODE.parse(matchMode);
		if (searchLimit) {
			VALIDATION_SCHEMA.NUMBER.parse(searchLimit);
		}

		VALIDATION_SCHEMA.BOOLEAN.parse(skipRecheck);
		VALIDATION_SCHEMA.BOOLEAN.parse(includeEpisodes);
		VALIDATION_SCHEMA.BOOLEAN.parse(includeSingleEpisodes);
		VALIDATION_SCHEMA.BOOLEAN.parse(includeNonVideos);
		VALIDATION_SCHEMA.BOOLEAN.parse(duplicateCategories);

		if (dataDirs) {
			VALIDATION_SCHEMA.PATH.parse(dataDirs);
			VALIDATION_SCHEMA.PATH.parse(linkDir);
			VALIDATION_SCHEMA.LINKTYPE.parse(linkType);
		}
		VALIDATION_SCHEMA.PATH.parse(outputDir);
		VALIDATION_SCHEMA.PATH.parse(torrentDir);
	} catch (errors) {
		throw new CrossSeedError(errors);
	}
	logger.info("Your configuration is zod valid!");
}
export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	validateOptions();
	await validateWithZod();
	logger.info("Your configuration is valid!");
}
