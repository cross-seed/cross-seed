import { constants, mkdir, stat } from "fs/promises";
import { spawn } from "node:child_process";
import { inspect } from "util";
import { testLinking } from "./action.js";
import { instantiateDownloadClients } from "./clients/TorrentClient.js";
import { applyDefaults, getFileConfig, transformFileConfig } from "./configuration.js";
import { db } from "./db.js";
import { getDbConfig, setDbConfig } from "./dbConfig.js";
import { CrossSeedError } from "./errors.js";
import {
	initializeLogger,
	Label,
	logger,
	exitOnCrossSeedErrors,
} from "./logger.js";
import { initializePushNotifier } from "./pushNotifier.js";
import {
	getRuntimeConfig,
	RuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { Awaitable, notExists, omitUndefined, verifyDir } from "./utils.js";
import { getLogWatcher } from "./utils/logWatcher.js";

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

export async function doStartupValidation(): Promise<void> {
	await checkConfigPaths(); // ensure paths are valid first
	instantiateDownloadClients();
}

/**
 * validates and sets RuntimeConfig
 * @return (the number of errors Zod encountered in the configuration)
 */
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

async function applyExistingApiKey(
	config: RuntimeConfig,
	contextMessage: string,
): Promise<void> {
	try {
		const existingApiKey = await db("settings").select("apikey").first();
		if (existingApiKey?.apikey && !config.apiKey) {
			config.apiKey = existingApiKey.apikey;
		}
	} catch (error) {
		logger.debug(contextMessage, error);
	}
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

		const definedCliOptions = omitUndefined(
			options as Partial<RuntimeConfig>,
		) as Partial<RuntimeConfig>;

		let runtimeConfig: RuntimeConfig | undefined;
		try {
			const dbConfig = await getDbConfig();
			runtimeConfig = {
				...dbConfig,
				...definedCliOptions,
			};
		} catch (dbError) {
			logger.debug("Unable to load configuration from database", dbError);
			try {
				const transformedFileConfig = transformFileConfig(
					await getFileConfig(),
				);
				const overrides = {
					...transformedFileConfig,
					...definedCliOptions,
				};
				const mergedConfig = applyDefaults(overrides);

				await applyExistingApiKey(
					mergedConfig,
					"Unable to read existing API key during file config migration",
				);

				await setDbConfig(mergedConfig);
				logger.info("Migrated file config to database");
				runtimeConfig = mergedConfig;
			} catch (migrationError) {
				logger.warn(
					"Failed to migrate file config, falling back to defaults",
					migrationError,
				);

				const mergedDefaults = applyDefaults(definedCliOptions);

				try {
					await setDbConfig(mergedDefaults);
					logger.info("Created initial database config from defaults");
				} catch (persistError) {
					logger.warn(
						"Failed to persist default configuration to database",
						persistError,
					);
				}

				runtimeConfig = mergedDefaults;
			}
		}

		if (!runtimeConfig) {
			runtimeConfig = applyDefaults(definedCliOptions);
		}

		setRuntimeConfig(runtimeConfig);
		initializePushNotifier();
		getLogWatcher();
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
