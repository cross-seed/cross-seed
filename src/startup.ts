import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Action } from "./constants.js";
import { validateTorznabUrls } from "./torznab.js";
import { getClient } from "./clients/TorrentClient.js";
import {
	RuntimeConfig,
	getRuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { existsSync } from "fs";
import { inspect } from "util";

/**
 * verifies the config paths provided against the filesystem
 * @returns true (if paths are valid)
 */
function checkConfigPaths(): void {
	const { action, linkDir, dataDirs, torrentDir, outputDir } =
		getRuntimeConfig();
	let pathFailure: number = 0;

	if (!existsSync(torrentDir)) {
		logger.error(
			`\tYour torrentDir "${torrentDir}" is not a valid directory on the filesystem.\n`
		);
		pathFailure++;
	}

	if (action == Action.SAVE && !existsSync(outputDir)) {
		logger.error(
			`\tYour outputDir path "${outputDir}" is not a valid directory on the filesystem.\n`
		);
		pathFailure++;
	}

	if (linkDir && !existsSync(linkDir)) {
		logger.error(
			`\tYour linkDir path "${linkDir}" is not a valid directory on the filesystem.\n`
		);
		pathFailure++;
	}
	if (dataDirs) {
		for (const dataDir of dataDirs) {
			if (!existsSync(dataDir)) {
				logger.error(
					`\tYour dataDirs path "${dataDir}" is not a valid directory on the filesystem.\n`
				);
				pathFailure++;
			}
		}
	}
	if (pathFailure) {
		throw new CrossSeedError(
			`\tYour configuration is invalid, please see the ${
				pathFailure > 1 ? "errors" : "error"
			} above for details.`
		);
	}
}

export async function doStartupValidation(): Promise<void> {
	const runtimeConfig: RuntimeConfig = getRuntimeConfig();
	checkConfigPaths();
	setRuntimeConfig(runtimeConfig);

	const downloadClient = getClient();
	await Promise.all<void>([
		validateTorznabUrls(),
		downloadClient?.validateConfig(),
	]);
	logger.verbose({
		label: Label.CONFIGDUMP,
		message: inspect(runtimeConfig),
	});
	logger.info("Your configuration is valid!");
}
