import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { existsSync } from "fs";
import { Action } from "./constants.js";
import { validateTorznabUrls } from "./torznab.js";
import { getClient } from "./clients/TorrentClient.js";

export async function doStartupValidation(): Promise<void> {
	try {
		checkConfigPaths();
	} catch (error) {
		throw new CrossSeedError(error.message.replace("Error: ", ""));
	}
	const downloadClient = getClient();
	await Promise.all<void>([
		validateTorznabUrls(),
		downloadClient?.validateConfig(),
	]);
	logger.info("Your configuration is valid!");
}

function checkConfigPaths() {
	const { action, linkDir, dataDirs, torrentDir, outputDir } =
		getRuntimeConfig();

	if (!existsSync(torrentDir)) {
		throw new Error(
			"'torrentDir' is not a valid directory on the filesystem."
		);
	}

	if (action == Action.SAVE && !existsSync(outputDir)) {
		throw new Error(
			"'outputDir' is not a valid directory on the filesystem."
		);
	}

	if (linkDir && !existsSync(linkDir)) {
		throw new Error(
			"'linkDir' is not a valid directory on the filesystem."
		);
	}
	if (dataDirs) {
		for (const dataDir of dataDirs) {
			if (!existsSync(dataDir)) {
				throw new Error(
					`'dataDirs' path '${dataDir}' is not a valid directory on the filesystem.`
				);
			}
		}
	}
}
