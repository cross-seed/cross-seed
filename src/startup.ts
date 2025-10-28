import { constants, mkdir, stat } from "fs/promises";
import { spawn } from "node:child_process";
import { testLinking } from "./action.js";
import { resetApiKey } from "./auth.js";
import { instantiateDownloadClients } from "./clients/TorrentClient.js";
import {
	createAppDirHierarchy,
	getDefaultRuntimeConfig,
	getFileConfig,
	stripDefaults,
	transformFileConfig,
} from "./configuration.js";
import { db } from "./db.js";
import { getDbConfig, setDbConfig } from "./dbConfig.js";
import {
	exitOnCrossSeedErrors,
	initializeLogger,
	Label,
	logger,
} from "./logger.js";
import type { Problem } from "./problems.js";
import { initializePushNotifier } from "./pushNotifier.js";
import {
	getRuntimeConfig,
	RuntimeConfig,
	setRuntimeConfig,
} from "./runtimeConfig.js";
import { Awaitable, notExists, verifyDir } from "./utils.js";
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
		if (!(await notExists(path))) continue;

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

type PathIssue =
	| "missing"
	| "unreadable"
	| "unwritable"
	| "cross-platform-linking"
	| "linking-failed";

interface PathProblemDescriptor {
	category:
		| "torrentDir"
		| "outputDir"
		| "injectDir"
		| "linkDirs"
		| "dataDirs";
	name: string;
	path: string;
	issue: PathIssue;
	message: string;
	severity: Problem["severity"];
}

function buildPathProblem(descriptor: PathProblemDescriptor): Problem {
	const { category, name, path, issue, message, severity } = descriptor;
	return {
		id: `path:${category}:${issue}:${path}`,
		severity,
		summary: `${name}: ${message}`,
		details: `Path: ${path}`,
		metadata: { category, path, issue },
	};
}

async function diagnoseDirForProblems(
	path: string,
	name: string,
	category: PathProblemDescriptor["category"],
	options: { read?: boolean; write?: boolean },
): Promise<PathProblemDescriptor | null> {
	const mode =
		(options.read ? constants.R_OK : 0) |
		(options.write ? constants.W_OK : 0);
	const exists = await verifyDir(path, name, mode);

	if (exists) return null;

	try {
		await stat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				category,
				name,
				path,
				issue: "missing",
				message: "Directory does not exist.",
				severity: "error",
			};
		}
	}

	return {
		category,
		name,
		path,
		issue: options.write ? "unwritable" : "unreadable",
		message: options.write
			? "cross-seed cannot write to this directory."
			: "cross-seed cannot read from this directory.",
		severity: "error",
	};
}

async function collectLinkingProblems(
	linkDirs: string[],
	dataDirs: string[],
): Promise<PathProblemDescriptor[]> {
	const problems: PathProblemDescriptor[] = [];
	if (!linkDirs.length || !dataDirs.length) return problems;

	const linkDirStats = await Promise.all(
		linkDirs.map(async (dir, index) => {
			const descriptor = await diagnoseDirForProblems(
				dir,
				`linkDir${index}`,
				"linkDirs",
				{ read: true, write: true },
			);
			return {
				path: dir,
				problem: descriptor,
				dev: descriptor ? null : (await stat(dir)).dev,
			};
		}),
	);

	for (const { problem } of linkDirStats) {
		if (problem) problems.push(problem);
	}

	const validLinkDirs = linkDirStats
		.filter(({ problem }) => problem === null)
		.map(({ path, dev }) => ({ path, dev }));

	if (!validLinkDirs.length) return problems;

	for (const [index, dataDir] of dataDirs.entries()) {
		const descriptor = await diagnoseDirForProblems(
			dataDir,
			`dataDir${index}`,
			"dataDirs",
			{ read: true },
		);
		if (descriptor) {
			problems.push(descriptor);
			continue;
		}

		try {
			const dataDev = (await stat(dataDir)).dev;
			const matchingLinkDir = validLinkDirs.find(
				(linkDir) => linkDir.dev === dataDev,
			);
			if (!matchingLinkDir) {
				problems.push({
					category: "linkDirs",
					name: "linkDir",
					path: validLinkDirs.map((dir) => dir.path).join(", "),
					issue: "cross-platform-linking",
					message:
						"No linkDir shares a filesystem with this dataDir, so linking will fail. Add a linkDir on the same device.",
					severity: "error",
				});
				continue;
			}

			const result = await testLinking(
				dataDir,
				`healthCheckSrc.cross-seed`,
				`healthCheckDest.cross-seed`,
			);
			if (!result) {
				problems.push({
					category: "linkDirs",
					name: "linkDir",
					path: matchingLinkDir.path,
					issue: "linking-failed",
					message:
						"Linking test failed. Check filesystem permissions and mounts.",
					severity: "warning",
				});
			}
		} catch (error) {
			logger.debug({ label: Label.INJECT, message: error });
			problems.push({
				category: "linkDirs",
				name: "linkDir",
				path: dataDir,
				issue: "linking-failed",
				message: "Linking test threw an error. See logs for details.",
				severity: "error",
			});
		}
	}

	return problems;
}

export async function collectPathProblems(): Promise<Problem[]> {
	const { torrentDir, outputDir, injectDir, linkDirs, dataDirs } =
		getRuntimeConfig();
	const problems: Problem[] = [];

	if (torrentDir) {
		const descriptor = await diagnoseDirForProblems(
			torrentDir,
			"torrentDir",
			"torrentDir",
			{ read: true },
		);
		if (descriptor) problems.push(buildPathProblem(descriptor));
	}

	if (outputDir) {
		const descriptor = await diagnoseDirForProblems(
			outputDir,
			"outputDir",
			"outputDir",
			{ read: true, write: true },
		);
		if (descriptor) problems.push(buildPathProblem(descriptor));
	}

	if (injectDir) {
		const descriptor = await diagnoseDirForProblems(
			injectDir,
			"injectDir",
			"injectDir",
			{ read: true, write: true },
		);
		if (descriptor) problems.push(buildPathProblem(descriptor));
	}

	const linkProblems = await collectLinkingProblems(
		linkDirs ?? [],
		dataDirs ?? [],
	);
	for (const descriptor of linkProblems) {
		problems.push(buildPathProblem(descriptor));
	}

	return problems;
}

export async function doStartupValidation(): Promise<void> {
	await ensureConfiguredDirectories();
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

	// first, try to load from database (existing user happy path)
	let dbOverrides: Partial<RuntimeConfig> | undefined;
	try {
		dbOverrides = await getDbConfig();
	} catch (dbError) {
		logger.debug("Unable to load configuration from database", dbError);
	}

	if (dbOverrides !== undefined) {
		return {
			...getDefaultRuntimeConfig(),
			...dbOverrides,
			...cliOptions,
		};
	}

	// then, try to migrate from file config (v6 to v7 upgrade path)
	try {
		const fileConfig = await getFileConfig();
		if (fileConfig) {
			const transformedFileConfig = transformFileConfig(fileConfig);
			const runtimeFromFile = {
				...getDefaultRuntimeConfig(),
				...transformedFileConfig,
			} as RuntimeConfig;
			await applyExistingApiKey(runtimeFromFile);
			await setDbConfig(runtimeFromFile);
			const resolvedOverrides = stripDefaults(runtimeFromFile);
			logger.info("Migrated file config to database");
			return {
				...getDefaultRuntimeConfig(),
				...resolvedOverrides,
				...cliOptions,
			};
		}
	} catch (migrationError) {
		logger.error(
			new Error(
				"Failed to import configuration file, falling back to defaults",
				{ cause: migrationError },
			),
		);
	}

	// finally, fall back to defaults (new user happy path or migration failure)
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
