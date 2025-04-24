import { access, constants, mkdir, stat } from "fs/promises";
import ms from "ms";
import { sep } from "path";
import { inspect } from "util";
import { testLinking } from "./action.js";
import { validateUArrLs } from "./arr.js";
import {
	getClients,
	instantiateDownloadClients,
} from "./clients/TorrentClient.js";
import { customizeErrorMessage, VALIDATION_SCHEMA } from "./configSchema.js";
import { NEWLINE_INDENT, PROGRAM_NAME, PROGRAM_VERSION } from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError, exitOnCrossSeedErrors } from "./errors.js";
import { initializeLogger, Label, logger } from "./logger.js";
import { initializePushNotifier } from "./pushNotifier.js";
import {
	getRuntimeConfig,
	RuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { validateTorznabUrls } from "./torznab.js";
import { Awaitable, mapAsync, notExists, wait } from "./utils.js";

export async function exitGracefully() {
	await db.destroy();
	process.exit();
}

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

/**
 * validates existence, permission, and that a path is a directory
 * @param path string of path to validate
 * @param optionName name of the configuration key
 * @param permissions number (see constants in calling function) of permission
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
						'\t\t\t\tMake sure to use "\\\\" or "/" for directory separators.',
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
	const { dataDirs, injectDir, linkDirs, outputDir, torrentDir } =
		getRuntimeConfig();
	const READ_ONLY = constants.R_OK;
	const READ_AND_WRITE = constants.R_OK | constants.W_OK;
	let pathFailure: number = 0;

	if (
		torrentDir &&
		!(await verifyPath(torrentDir, "torrentDir", READ_ONLY))
	) {
		pathFailure++;
	}

	if (await notExists(outputDir)) {
		logger.info(`Creating outputDir: ${outputDir}`);
		await mkdir(outputDir, { recursive: true });
	}
	if (!(await verifyPath(outputDir, "outputDir", READ_AND_WRITE))) {
		pathFailure++;
	}

	for (const linkDir of linkDirs) {
		if (await notExists(linkDir)) {
			logger.info(`Creating linkDir: ${linkDir}`);
			await mkdir(linkDir, { recursive: true });
		}
		if (!(await verifyPath(linkDir, "linkDir", READ_AND_WRITE))) {
			pathFailure++;
		}
	}
	for (const dataDir of dataDirs) {
		if (!(await verifyPath(dataDir, "dataDirs", READ_ONLY))) {
			pathFailure++;
		}
	}
	if (injectDir) {
		if (!(await verifyPath(injectDir, "injectDir", READ_AND_WRITE))) {
			pathFailure++;
		}
	}
	if (linkDirs.length) {
		for (const dataDir of dataDirs) {
			try {
				await testLinking(
					dataDir,
					"dataDirSrc.cross-seed",
					"dataDirDest.cross-seed",
				);
			} catch (e) {
				logger.error(e);
				logger.error("Failed to link from dataDirs to linkDir.");
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

async function retry<T>(
	cb: () => Promise<T>,
	numRetries: number,
	delayMs: number,
): Promise<T> {
	const retries = Math.max(numRetries, 0);
	let lastError = new Error("Retry failed");
	for (let i = 0; i <= retries; i++) {
		try {
			return await cb();
		} catch (e) {
			const retryMsg =
				i < retries ? `, retrying in ${delayMs / 1000}s` : "";
			logger.error(
				`Attempt ${i + 1}/${retries + 1} failed${retryMsg}: ${e.message}`,
			);
			logger.debug(e);
			lastError = e;
			if (i >= retries) break;
			await wait(delayMs);
		}
	}
	throw lastError;
}

export async function doStartupValidation(): Promise<void> {
	await checkConfigPaths(); // ensure paths are valid first
	instantiateDownloadClients();
	const validateClientConfig = () =>
		mapAsync(getClients(), (client) => client.validateConfig());
	const errors = (
		await Promise.allSettled([
			retry(validateTorznabUrls, 5, ms("1 minute")),
			retry(validateUArrLs, 5, ms("1 minute")),
			retry(validateClientConfig, 5, ms("1 minute")),
		])
	).filter((p) => p.status === "rejected");
	if (errors.length) {
		throw new CrossSeedError(
			`\tYour configuration is invalid, please see the ${errors.length > 1 ? "errors" : "error"} above for details.`,
		);
	}
	logger.verbose({
		label: Label.CONFIGDUMP,
		message: inspect(getRuntimeConfig()),
	});
	logger.info("Your configuration is valid!");
}

/**
 * validates and sets RuntimeConfig
 * @return (the number of errors Zod encountered in the configuration)
 */
export function parseRuntimeConfigAndLogErrors(
	options: unknown,
): RuntimeConfig {
	logger.info(`${PROGRAM_NAME} v${PROGRAM_VERSION}`);
	logger.info("Validating your configuration...");
	let parsedOptions: RuntimeConfig;
	try {
		parsedOptions = VALIDATION_SCHEMA.parse(options, {
			errorMap: customizeErrorMessage,
		}) as RuntimeConfig;
	} catch (error) {
		logger.verbose({
			label: Label.CONFIGDUMP,
			message: inspect(options),
		});
		if ("errors" in error && Array.isArray(error.errors)) {
			error.errors.forEach(({ path, message }) => {
				const urlPath = path[0];
				const optionLine =
					path.length === 2
						? `${path[0]} (position #${path[1] + 1})`
						: path;
				logger.error(
					`${
						path.length > 0
							? `Option: ${optionLine}`
							: "Configuration:"
					}${NEWLINE_INDENT}${message}${NEWLINE_INDENT}(https://www.cross-seed.org/docs/basics/options${
						urlPath ? `#${urlPath.toLowerCase()}` : ""
					})\n`,
				);
			});
			if (error.errors.length > 0) {
				throw new CrossSeedError(
					`Your configuration is invalid, please see the ${
						error.errors.length > 1 ? "errors" : "error"
					} above for details.`,
				);
			}
		}
		throw error;
	}

	return parsedOptions;
}

/**
 * starts singletons, then runs the callback, then cleans up
 * @param entrypoint
 */

type CommanderActionCb = (
	options: Record<string, unknown>,
) => void | Promise<void>;

/**
 * Initializes only the database, runs the callback, then cleans up
 */
export function withMinimalRuntime<
	T extends (...args: unknown[]) => Awaitable<string | void>,
>(
	entrypoint: T,
	{ migrate = true } = {},
): (...args: Parameters<T>) => Promise<void> {
	return async (...args: Parameters<T>) => {
		try {
			if (migrate) await db.migrate.latest();
			const output = await entrypoint(...args);
			if (output) console.log(output);
		} catch (e) {
			exitOnCrossSeedErrors(e);
		} finally {
			await exitGracefully();
		}
	};
}

/**
 * Initializes the full runtime, runs the callback, then cleans up
 * @param entrypoint
 */
export function withFullRuntime(
	entrypoint: (runtimeConfig: RuntimeConfig) => Promise<void>,
): CommanderActionCb {
	return withMinimalRuntime(async (options) => {
		initializeLogger(options as Record<string, unknown>);
		const runtimeConfig = parseRuntimeConfigAndLogErrors(options);
		setRuntimeConfig(runtimeConfig);
		initializePushNotifier();
		await doStartupValidation();
		await entrypoint(runtimeConfig);
	});
}
