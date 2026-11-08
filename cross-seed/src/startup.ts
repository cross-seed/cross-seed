import {
	ConfigurationError,
	getDaemonRecovery,
	registerRecoveryResume,
	setDaemonRecovery,
} from "./daemonRecovery.js";
import { RUNTIME_CONFIG_SCHEMA, parseRuntimeConfig } from "./configSchema.js";
import { z } from "zod";
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
import { parseRuntimeConfigOverrides } from "./configSchema.js";

let exiting: Promise<void> | undefined;
export function exitGracefully(): Promise<void> {
	exiting ??= (async () => {
		await drainShutdownHooks();
		await destroyDataDirWatchers();
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
	let cliOptions: Partial<RuntimeConfig>;
	try {
		cliOptions = parseRuntimeConfigOverrides(omitUndefined(rawOptions));
	} catch (cause) {
		throw new CrossSeedError(
			"Invalid command-line settings. Check the supplied values and use --help for supported options.",
			{ cause },
		);
	}

	// first, try to load from database (existing user happy path)
	let dbOverrides: Partial<RuntimeConfig> | undefined;
	try {
		dbOverrides = await getDbConfig();
	} catch (dbError) {
		const message =
			"Failed to load settings from the database. Stored settings and the API key have not been changed. " +
			"Back up your database before recovery. Use `cross-seed db check` to diagnose database errors, " +
			"or `cross-seed config import <file>` to restore settings from valid JSON.";
		if (dbError instanceof SyntaxError || dbError instanceof z.ZodError)
			throw new ConfigurationError(message, "database", {
				cause: dbError,
			});
		throw new CrossSeedError(message, { cause: dbError });
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
		try {
			await validateSourceLayout(resolved);
		} catch (cause) {
			throw new ConfigurationError(
				cause instanceof Error ? cause.message : String(cause),
				"database",
				{ cause },
			);
		}
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
		throw new ConfigurationError(
			`Failed to import configuration file ${getFileConfigPath()}. Fix the file and restart cross-seed; default settings have not been saved.`,
			"file",
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

/** Start HTTP for configuration errors without activating the operational runtime. */
async function recoveryRuntime(
	error: ConfigurationError,
	options: Record<string, unknown>,
): Promise<RuntimeConfig> {
	// A genuine SQLite read failure still propagates. Never write bootstrap defaults.
	const row = await db("settings").select("settings_json", "apikey").first();
	let stored: Record<string, unknown> = {};
	try {
		const value: unknown = JSON.parse(row?.settings_json ?? "null");
		if (value && typeof value === "object" && !Array.isArray(value))
			stored = value as Record<string, unknown>;
	} catch {
		/* The authenticated JSON editor can repair malformed settings. */
	}
	const bootstrap = getDefaultRuntimeConfig();
	// Validate fields individually so unrelated invalid settings don't hide the UI.
	// Preserve usable values for the listener and authentication; don't activate sources.
	for (const key of [
		"host",
		"port",
		"basePath",
		"verbose",
		"apiKey",
	] as const) {
		const parsed = RUNTIME_CONFIG_SCHEMA.shape[key].safeParse(stored[key]);
		if (parsed.success && parsed.data !== undefined)
			Object.assign(bootstrap, { [key]: parsed.data });
	}
	if (!bootstrap.apiKey && row?.apikey) bootstrap.apiKey = row.apikey;
	Object.assign(
		bootstrap,
		parseRuntimeConfigOverrides(omitUndefined(options)),
	);
	const schema = RUNTIME_CONFIG_SCHEMA.safeParse({
		...getDefaultRuntimeConfig(),
		...stored,
	});
	setDaemonRecovery({
		message:
			error.cause instanceof z.ZodError
				? error.cause.issues
						.map(
							(issue) =>
								`${issue.path.join(".") || "settings"}: ${issue.message}`,
						)
						.join("\n")
				: error.cause instanceof Error
					? error.cause.message
					: error.message,
		source: error.source,
		useJsonEditor:
			error.source === "database" &&
			(!schema.success ||
				row?.settings_json == null ||
				Object.keys(stored).length === 0),
	});
	logger.error({
		label: Label.SERVER,
		message: `${error.message} Starting the Web UI in recovery mode; searches, indexing and injection are paused.`,
	});
	return bootstrap;
}

/** Initialize the runtime, optionally leaving the daemon available for settings recovery. */
export function withFullRuntime(
	entrypoint: (runtimeConfig: RuntimeConfig) => Promise<void>,
	options: { recoverSettings?: boolean; onRecovered?: () => void } = {},
): CommanderActionCb {
	return withMinimalRuntime(async (rawOptions: Record<string, unknown>) => {
		createAppDirHierarchy();
		const configureLogger = initializeLogger(rawOptions);
		async function activate(config: RuntimeConfig) {
			configureLogger(config);
			setRuntimeConfig(config);
			await ensureConfiguredDirectories();
			instantiateDownloadClients();
			initializePushNotifier();
		}
		let runtimeConfig: RuntimeConfig;
		try {
			runtimeConfig = await determineRuntimeConfig(rawOptions);
		} catch (error) {
			if (
				!options.recoverSettings ||
				!(error instanceof ConfigurationError)
			)
				throw error;
			runtimeConfig = await recoveryRuntime(error, rawOptions);
		}
		if (getDaemonRecovery()) {
			configureLogger(runtimeConfig);
			setRuntimeConfig(runtimeConfig);
			registerRecoveryResume(async (config) => {
				// Listener changes apply on restart; retain the actual HTTP identity.
				const { host, port, basePath } = runtimeConfig;
				await activate(
					parseRuntimeConfig({ ...config, host, port, basePath }),
				);
				setDaemonRecovery(null);
				options.onRecovered?.();
			});
		} else await activate(runtimeConfig);
		getLogWatcher();
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
