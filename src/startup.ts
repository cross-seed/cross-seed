import { constants, mkdir, stat } from "fs/promises";
import ms from "ms";
import { spawn } from "node:child_process";
import { inspect } from "util";
import { testLinking } from "./action.js";
import { validateUArrLs } from "./arr.js";
import {
	getClients,
	instantiateDownloadClients,
} from "./clients/TorrentClient.js";
import { customizeErrorMessage, VALIDATION_SCHEMA } from "./configSchema.js";
import { getFileConfig } from "./configuration.js";
import { NEWLINE_INDENT, PROGRAM_NAME, PROGRAM_VERSION } from "./constants.js";
import { db } from "./db.js";
import { getDbConfig, isDbConfigEnabled, setDbConfig } from "./dbConfig.js";
import { createRequire } from "module";
import { CrossSeedError, exitOnCrossSeedErrors } from "./errors.js";
import { initializeLogger, Label, logger } from "./logger.js";
import { initializePushNotifier } from "./pushNotifier.js";
import {
	getRuntimeConfig,
	RuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { validateTorznabUrls } from "./torznab.js";
import { Awaitable, mapAsync, notExists, verifyDir, wait } from "./utils.js";

const require = createRequire(import.meta.url);

export async function exitGracefully() {
	await db.destroy();
	process.exit();
}

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

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
	const linkDev: { path: string; dev: number }[] = [];
	const dataDev: { path: string; dev: number }[] = [];

	if (torrentDir && !(await verifyDir(torrentDir, "torrentDir", READ_ONLY))) {
		pathFailure++;
	}

	if (await notExists(outputDir)) {
		logger.info(`Creating outputDir: ${outputDir}`);
		await mkdir(outputDir, { recursive: true });
	}
	if (!(await verifyDir(outputDir, "outputDir", READ_AND_WRITE))) {
		pathFailure++;
	}

	for (const [index, linkDir] of linkDirs.entries()) {
		const linkDirName = `linkDir${index}`;
		if (await notExists(linkDir)) {
			logger.info(`Creating ${linkDirName}: ${linkDir}`);
			await mkdir(linkDir, { recursive: true });
		}
		if (await verifyDir(linkDir, linkDirName, READ_AND_WRITE)) {
			linkDev.push({ path: linkDir, dev: (await stat(linkDir)).dev });
		} else {
			pathFailure++;
		}
	}
	if (linkDev.length) {
		logger.verbose(`Storage device for each linkDir: ${inspect(linkDev)}`);
	}
	for (const [index, dataDir] of dataDirs.entries()) {
		const dataDirName = `dataDir${index}`;
		if (await verifyDir(dataDir, dataDirName, READ_ONLY)) {
			dataDev.push({ path: dataDir, dev: (await stat(dataDir)).dev });
		} else {
			pathFailure++;
		}
	}
	if (dataDev.length) {
		logger.verbose(`Storage device for each dataDir: ${inspect(dataDev)}`);
	}
	if (injectDir) {
		if (!(await verifyDir(injectDir, "injectDir", READ_AND_WRITE))) {
			pathFailure++;
		}
	}
	if (linkDirs.length) {
		for (const [index, dataDir] of dataDirs.entries()) {
			const dataDirName = `dataDir${index}`;
			try {
				const res = await testLinking(
					dataDir,
					`${dataDirName}Src.cross-seed`,
					`${dataDirName}Dest.cross-seed`,
				);
				if (!res) {
					logger.error("Failed to link from dataDirs to linkDirs.");
				}
			} catch (e) {
				logger.error(e);
				logger.error("Failed to link from dataDirs to linkDirs.");
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
	if (linkDev.length) {
		logger.verbose({
			label: Label.INJECT,
			message: `Storage device for each linkDir: ${inspect(linkDev)}`,
		});
	}
	if (dataDev.length) {
		logger.verbose({
			label: Label.INJECT,
			message: `Storage device for each dataDir: ${inspect(dataDev)}`,
		});
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
		label: Label.CONFIG,
		message: inspect(getRuntimeConfig()),
	});
	logger.info({
		label: Label.CONFIG,
		message: "Your configuration is valid!",
	});
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
			label: Label.CONFIG,
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

		let runtimeConfig: RuntimeConfig;
		if (isDbConfigEnabled()) {
			try {
				// Load config from database
				runtimeConfig = await getDbConfig();
			} catch {
				// No complete config in database, migrate from file or template
				try {
					// Try to load and migrate from file config
					const fileConfig = await getFileConfig();
					runtimeConfig = parseRuntimeConfigAndLogErrors({
						...fileConfig,
						...(options as Record<string, unknown>),
					});

					// Preserve existing API key from apikey column
					const existingApiKey = await db("settings")
						.select("apikey")
						.first();
					if (existingApiKey?.apikey && !runtimeConfig.apiKey) {
						runtimeConfig.apiKey = existingApiKey.apikey;
					}

					await setDbConfig(runtimeConfig);
					logger.info("Migrated file config to database");
				} catch {
					// No file config - use template directly
					const templateConfig = require("./config.template.cjs")
						.default as Record<string, unknown>;
					runtimeConfig = parseRuntimeConfigAndLogErrors({
						...templateConfig,
						...(options as Record<string, unknown>),
					});

					// Preserve existing API key from apikey column
					const existingApiKey = await db("settings")
						.select("apikey")
						.first();
					if (existingApiKey?.apikey && !runtimeConfig.apiKey) {
						runtimeConfig.apiKey = existingApiKey.apikey;
					}

					await setDbConfig(runtimeConfig);
					logger.info(
						"Created initial database config from template",
					);
				}
			}
		} else {
			// Load config from file + CLI options
			runtimeConfig = parseRuntimeConfigAndLogErrors(options);
		}

		setRuntimeConfig(runtimeConfig);
		initializePushNotifier();
		await doStartupValidation();
		await entrypoint(runtimeConfig);
	});
}

export async function restartCrossSeed() {
	logger.info("Restarting cross-seed");
	process.on("exit", () => {
		spawn(process.argv[0], process.argv.slice(1), {
			cwd: process.cwd(),
			stdio: "inherit",
			detached: false,
		});
	});

	await exitGracefully();
}
