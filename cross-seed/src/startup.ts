import { validateSourceLayout } from "./sourcePaths.js";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { runInBackground } from "./utils/background.js";
import { drainShutdownHooks } from "./utils/shutdown.js";
import { resetApiKey } from "./auth.js";
import { instantiateDownloadClients } from "./clients/TorrentClient.js";
import {
	createAppDirHierarchy,
	getDefaultRuntimeConfig,
	getFileConfig,
	getFileConfigPath,
	stripDefaults,
	transformFileConfig,
} from "./configuration.js";
import { destroyDataDirWatchers } from "./dataFiles.js";
import { db } from "./db.js";
import { getDbConfig, setDbConfig } from "./dbConfig.js";
import { CrossSeedError } from "./errors.js";
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

let exiting: Promise<void> | undefined;
export function exitGracefully(): Promise<void> {
	exiting ??= (async () => {
		await drainShutdownHooks();
		destroyDataDirWatchers();
		await db.destroy();
		process.exit();
	})();
	return exiting;
}

export function handleExitSignal(): void {
	runInBackground(exitGracefully());
}

process.on("SIGINT", handleExitSignal);
process.on("SIGTERM", handleExitSignal);

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

const MIGRATED_CONFIG_COMMENT =
	"// This config.js file was imported into the cross-seed v7 database. Use the Web UI to view or change settings.\n\n";

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
	} catch {
		// best-effort only
	}
}

async function getFileConfigBackupPath(configPath: string): Promise<string> {
	const basePath = `${configPath}.bak`;
	if (await notExists(basePath)) {
		return basePath;
	}

	for (let index = 1; ; index++) {
		const candidate = `${basePath}.${index}`;
		if (await notExists(candidate)) {
			return candidate;
		}
	}
}

async function backupFileConfig(): Promise<string> {
	const configPath = getFileConfigPath();
	const backupPath = await getFileConfigBackupPath(configPath);
	await rename(configPath, backupPath);
	const backupContents = await readFile(backupPath, "utf8");
	await writeFile(backupPath, `${MIGRATED_CONFIG_COMMENT}${backupContents}`);
	return backupPath;
}

export async function determineRuntimeConfig(
	rawOptions: Record<string, unknown>,
) {
	const cliOptions = omitUndefined(rawOptions) as Partial<RuntimeConfig>;

	// first, try to load from database (existing user happy path)
	let dbOverrides: Partial<RuntimeConfig> | undefined;
	try {
		dbOverrides = await getDbConfig();
	} catch (dbError) {
		throw new CrossSeedError(
			"Failed to load settings from the database. Stored settings and the API key have not been changed. " +
				"Back up your database before recovery. Use `cross-seed db check` to diagnose database errors, " +
				"or `cross-seed config import <file>` to restore settings from valid JSON.",
			{ cause: dbError },
		);
	}

	// Recover upgrades where migration 17 created an API-key-only config before
	// the file could be imported. Require the legacy key and original file so
	// ordinary v7 database configuration continues to take precedence.
	if (
		dbOverrides?.apiKey &&
		Object.keys(dbOverrides).length === 1 &&
		!(await notExists(getFileConfigPath()))
	) {
		const legacySettings = await db("settings").select("apikey").first();
		if (legacySettings?.apikey === dbOverrides.apiKey) {
			dbOverrides = undefined;
		}
	}

	if (dbOverrides !== undefined) {
		const resolved = {
			...getDefaultRuntimeConfig(),
			...dbOverrides,
			...cliOptions,
		};
		await validateSourceLayout(resolved);
		return resolved;
	}

	// then, try to migrate from file config (v6 to v7 upgrade path)
	try {
		const fileConfig = await getFileConfig();
		if (fileConfig) {
			const transformedFileConfig = transformFileConfig(fileConfig);
			const runtimeFromFile = {
				...getDefaultRuntimeConfig(),
				...transformedFileConfig,
			};
			await applyExistingApiKey(runtimeFromFile);
			await setDbConfig(runtimeFromFile);
			const resolvedOverrides = stripDefaults(runtimeFromFile);
			const backupPath = await backupFileConfig();
			logger.info(
				`Migrated file config to database; v7 now uses database/Web UI settings. Preserved old config file as ${path.basename(
					backupPath,
				)}.`,
			);
			return {
				...getDefaultRuntimeConfig(),
				...resolvedOverrides,
				...cliOptions,
			};
		}
	} catch (migrationError) {
		throw new CrossSeedError(
			`Failed to import configuration file ${getFileConfigPath()}. Fix the file and restart cross-seed; default settings have not been saved.`,
			{ cause: migrationError },
		);
	}

	// Only a new installation without a config file should create defaults.
	const defaultRuntime = getDefaultRuntimeConfig();
	await setDbConfig(defaultRuntime);
	await resetApiKey();
	logger.info("Created initial database config from defaults");
	const resolvedOverrides = stripDefaults(defaultRuntime);

	return {
		...getDefaultRuntimeConfig(),
		...resolvedOverrides,
		...cliOptions,
	};
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
