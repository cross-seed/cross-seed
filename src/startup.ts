import { getClient } from "./clients/TorrentClient.js";
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { validateTorrentDir } from "./torrent.js";
import { validateTorznabUrls } from "./torznab.js";

function validateOptions() {
	const { action, rtorrentRpcUrl, qbittorrentUrl, transmissionRpcUrl } =
		getRuntimeConfig();
	if (
		action === "inject" &&
		!(rtorrentRpcUrl || qbittorrentUrl || transmissionRpcUrl)
	) {
		throw new CrossSeedError(
			"You need to specify --rtorrent-rpc-url, --transmission-rpc-url, or --qbittorrent-url when using '-A inject'."
		);
	}
}

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	validateOptions();
	const downloadClient = getClient();
	await Promise.all<void>(
		[
			validateTorznabUrls(),
			downloadClient?.validateConfig(),
			validateTorrentDir(),
		].filter(Boolean)
	);
	logger.info("Your configuration is valid!");
}
