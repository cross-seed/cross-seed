import { sep } from "path";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Action } from "./constants.js";
import { validateTorznabUrls } from "./torznab.js";
import { getClient } from "./clients/TorrentClient.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { inspect } from "util";
import { stat, access, constants } from "fs/promises";

/**
 * validates existence, permission, and that a path is a directory
 * @param path string of path to validate
 * @param optionName name of the configuration key
 * @returns true if path exists and has required permission
 */
async function verifyPath(
	path: string,
	optionName: string,
	permissions: number,
): Promise<boolean> {
	try {
		if ((await stat(path)).isDirectory()) {
			await access(path, permissions);
			return true;
		}
	} catch (error) {
		if (error.code === "ENOENT") {
			logger.error(
				`\tYour ${optionName} "${path}" is not a valid directory on the filesystem.`,
			);
			if (sep === "\\" && !path.includes("\\") && !path.includes("/")) {
				logger.error(
					"\tIt may not be formatted properly for Windows.\n" +
						'Please use "\\\\"or "/" for directory separators.',
				);
			}
		} else {
			logger.error(
				`\tYour ${optionName} "${path}" has invalid permissions.`,
			);
		}
	}
	return false;
}

/**
 * verifies the config paths provided against the filesystem
 * @returns true (if paths are valid)
 */
async function checkConfigPaths(): Promise<void> {
	const { action, linkDir, dataDirs, torrentDir, outputDir, rtorrentRpcUrl } =
		getRuntimeConfig();
	const READ_ONLY = constants.R_OK;
	const READ_AND_WRITE = constants.R_OK | constants.W_OK;
	let pathFailure: number = 0;

	if (
		typeof torrentDir === "string" &&
		!(await verifyPath(torrentDir, "torrentDir", READ_ONLY))
	) {
		pathFailure++;
	}

	if (
		(action === Action.SAVE || rtorrentRpcUrl) &&
		!(await verifyPath(outputDir, "outputDir", READ_AND_WRITE))
	) {
		pathFailure++;
	}

	if (linkDir && !(await verifyPath(linkDir, "linkDir", READ_AND_WRITE))) {
		pathFailure++;
	}
	if (dataDirs) {
		for (const dataDir of dataDirs) {
			if (!(await verifyPath(dataDir, "dataDirs", READ_ONLY))) {
				pathFailure++;
			}
		}
	}
	if (pathFailure) {
		throw new CrossSeedError(
			`\tYour configuration is invalid, please see the ${
				pathFailure > 1 ? "errors" : "error"
			} above for details.`,
		);
	}
}

export async function doStartupValidation(): Promise<void> {
	const downloadClient = getClient();
	await Promise.all<void>([
		checkConfigPaths(),
		validateTorznabUrls(),
		downloadClient?.validateConfig(),
	]);
	logger.verbose({
		label: Label.CONFIGDUMP,
		message: inspect(getRuntimeConfig()),
	});
	logger.info("Your configuration is valid!");
}
