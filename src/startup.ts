import { getClient } from "./clients/TorrentClient.js";
import { MatchMode } from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { validateTorrentDir } from "./torrent.js";
import { validateTorznabUrls } from "./torznab.js";
import { validateAction } from "./action.js";

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
		qbittorrentCategories,
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
	if (qbittorrentCategories && !qbittorrentUrl) {
		throw new CrossSeedError(
			"You need to specify --qbittorrent-url when using --qbittorrent-categories."
		);
	}
	if (matchMode == MatchMode.RISKY && skipRecheck) {
		logger.warn(
			"It is strongly recommended to not skip rechecking for risky matching mode"
		);
	}
}

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	validateOptions();
	const downloadClient = getClient();
	await Promise.all<void>(
		[
			validateAction(),
			validateTorznabUrls(),
			downloadClient?.validateConfig(),
			validateTorrentDir(),
		].filter(Boolean)
	);
	logger.info("Your configuration is valid!");
}
