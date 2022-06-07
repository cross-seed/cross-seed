import { getClient } from "./clients/TorrentClient.js";
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { validateTorrentDir } from "./torrent.js";
import { getTorznabManager, TorznabManager } from "./torznab.js";

function validateOptions() {
	const { action, rtorrentRpcUrl, qbittorrentUrl } = getRuntimeConfig();
	if (action === "inject" && !(rtorrentRpcUrl || qbittorrentUrl)) {
		throw new CrossSeedError(
			"You need to specify --rtorrent-rpc-url or --qbittorrent-url when using '-A inject'."
		);
	}
}

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	validateOptions();
	const downloadClient = getClient();
	const torznabManager = getTorznabManager();
	await Promise.all<void>(
		[
			torznabManager.validateTorznabUrls(),
			downloadClient?.validateConfig(),
			validateTorrentDir(),
		].filter(Boolean)
	);
	logger.info("Your configuration is valid!");
}
