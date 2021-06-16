import { getClient } from "./clients/TorrentClient";
import { validateJackettApi } from "./jackett";
import { logger } from "./logger";

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	const downloadClient = getClient();
	await Promise.all<void>(
		[
			validateJackettApi(),
			downloadClient && downloadClient.validateConfig(),
		].filter(Boolean)
	);
	logger.info("Your configuration is valid!");
}
