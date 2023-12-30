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
import { sep } from "path";
import { inspect } from "util";

export async function doStartupValidation(
	zodErrorCount: number
): Promise<void> {
	const runtimeConfig: RuntimeConfig = getRuntimeConfig();
	const validConfigPaths = checkConfigPaths();
	runtimeConfig.configValid = !zodErrorCount && validConfigPaths;
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
	if (!runtimeConfig.configValid) {
		throw new CrossSeedError(
			`Your configuration is invalid, please see the ${
				zodErrorCount > 1 || (zodErrorCount > 0 && !validConfigPaths)
					? "errors"
					: "error"
			} above for details.`
		);
	}
	logger.info("Your configuration is valid!");
}
/**
 * verifies the config paths provided against the filesystem
 * @returns true (if paths are valid)
 */
function checkConfigPaths(): boolean {
	const { action, linkDir, dataDirs, torrentDir, outputDir } =
		getRuntimeConfig();

	let pathFailure = false;
	if (!existsSync(torrentDir)) {
		reportBadPath("torrentDir", torrentDir);
		pathFailure = true;
	}

	if (action == Action.SAVE && !existsSync(outputDir)) {
		reportBadPath("outputDir", outputDir);
		pathFailure = true;
	}

	if (linkDir && !existsSync(linkDir)) {
		reportBadPath("linkDir", linkDir);
		pathFailure = true;
	}
	if (dataDirs) {
		for (const dataDir of dataDirs) {
			if (!existsSync(dataDir)) {
				reportBadPath("dataDirs", dataDir);
				pathFailure = true;
			}
		}
	}
	return !pathFailure;
}
/**
 * logs an error message for invalid path settings (either filesystem or formatting)
 * @param configSetting (the name of the option set)
 * @param configValue (the value the option is set to)
 */
function reportBadPath(configSetting: string, configValue: string) {
	const pathError =
		sep === "\\" &&
		!configValue.includes("\\") &&
		!configValue.includes("/")
			? `Your ${configSetting} "${configValue}" is not formatted properly for Windows. Please use "\\\\" or "/" for directory separators.\n`
			: `Your ${configSetting} "${configValue}" is not a valid directory on the filesystem.\n`;
	logger.error(pathError);
}
