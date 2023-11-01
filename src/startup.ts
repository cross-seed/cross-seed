import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { VALIDATION_SCHEMA } from "./zod.js";
import { existsSync } from "fs";
import { Action } from "./constants.js";

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	try {
		VALIDATION_SCHEMA.parse(getRuntimeConfig());
		checkConfigPaths();
	} catch (error) {
		logger.error(
			"Your configuration is invalid, please see the error below for details."
		);
		logger.error(
			"Documentation: https://www.cross-seed.org/docs/basics/options#all-options"
		);
		throw new CrossSeedError(error.message.replace("Error: ", ""));
	}
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
