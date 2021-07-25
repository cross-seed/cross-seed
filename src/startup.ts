import { getClient } from "./clients/TorrentClient";
import { CrossSeedError } from "./errors";
import { validateJackettApi } from "./jackett";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";
import { validateTorrentDir } from "./torrent";

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
	await Promise.all<void>(
		[
			validateJackettApi(),
			downloadClient && downloadClient.validateConfig(),
			validateTorrentDir(),
		].filter(Boolean)
	);
	logger.info("Your configuration is valid!");
}
