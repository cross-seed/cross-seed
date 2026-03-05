import { mkdir } from "fs/promises";
import { spawn } from "node:child_process";
import { resetApiKey } from "./auth.js";
import { instantiateDownloadClients } from "./clients/TorrentClient.js";
import {
	createAppDirHierarchy,
	getDefaultRuntimeConfig,
	getFileConfig,
	transformFileConfig,
} from "./configuration.js";
import { db } from "./db.js";
import { setDbConfig } from "./dbConfig.js";
import {
	exitOnCrossSeedErrors,
	initializeLogger,
	Label,
	logger,
} from "./logger.js";
import { initializePushNotifier } from "./pushNotifier.js";
import {
	getRuntimeConfig,
	RuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { Awaitable, notExists } from "./utils.js";
import { getLogWatcher } from "./utils/logWatcher.js";
import { omitUndefined } from "./utils/object.js";

export async function exitGracefully() {
	await db.destroy();
	process.exit();
}

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

async function ensureConfiguredDirectories(): Promise<void> {
	const { outputDir, linkDirs = [] } = getRuntimeConfig();
	const directories: { path: string; label: string }[] = [];

	if (outputDir) {
		directories.push({ path: outputDir, label: "outputDir" });
	}

	for (const [index, linkDir] of linkDirs.entries()) {
		directories.push({ path: linkDir, label: `linkDir${index}` });
	}

	for (const { path, label } of directories) {
		if (!(await notExists(path))) {
			continue;
		}

		try {
			logger.info(`Creating ${label}: ${path}`);
			await mkdir(path, { recursive: true });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error ?? "");
			logger.error({
				label: Label.SERVER,
				message: `Failed to create ${label} at ${path}: ${message}`,
			});
		}
	}
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

async function applyExistingApiKey(config: RuntimeConfig): Promise<void> {
	try {
		const existingApiKey = await db("settings").select("apikey").first();
		if (existingApiKey?.apikey && !config.apiKey) {
			config.apiKey = existingApiKey.apikey;
		}
	} catch (error) {
		// best-effort only
	}
}

async function determineRuntimeConfig(rawOptions: Record<string, unknown>) {
	const cliOptions = omitUndefined(rawOptions) as Partial<RuntimeConfig>;

	// Always read config.js when present (source of truth per docs)
	let fileOverrides: Partial<RuntimeConfig> = {};
	try {
		const fileConfig = await getFileConfig();
		if (fileConfig) {
			fileOverrides = transformFileConfig(fileConfig);
			logger.info("Loaded configuration from config.js");
		}
	} catch (fileError) {
		logger.error(
			new Error("Failed to import configuration file, using defaults", {
				cause: fileError,
			}),
		);
	}

	// Merge: defaults ← config.js ← CLI options
	const runtimeConfig = {
		...getDefaultRuntimeConfig(),
		...fileOverrides,
		...cliOptions,
	} as RuntimeConfig;

	// Preserve API key from DB if not set in config.js/CLI
	await applyExistingApiKey(runtimeConfig);

	// Persist to DB so WebUI/API reflects current state
	await setDbConfig(runtimeConfig);

	// Generate API key on first-ever startup (no key in DB or config)
	if (!runtimeConfig.apiKey) {
		runtimeConfig.apiKey = await resetApiKey();
	}

	return runtimeConfig;
}

/**
 * Initializes the full runtime, runs the callback, then cleans up
 * @param entrypoint
 */
export function withFullRuntime(
	entrypoint: (runtimeConfig: RuntimeConfig) => Promise<void>,
): CommanderActionCb {
	return withMinimalRuntime(async (options: Record<string, unknown>) => {
		createAppDirHierarchy();
		initializeLogger(options);
		const runtimeConfig = await determineRuntimeConfig(options);
		setRuntimeConfig(runtimeConfig);
		initializePushNotifier();
		getLogWatcher();
		await ensureConfiguredDirectories();
		instantiateDownloadClients();
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
