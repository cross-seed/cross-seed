import { getClient } from "./clients/TorrentClient";
import { validateJackettApi } from "./jackett";
import { logger } from "./logger";
import { validateTorrentDir } from "./torrent";

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
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
