import chalk from "chalk";
import { accessSync, constants, mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import ms from "ms";
import { isDeepStrictEqual } from "node:util";
import {
	Action,
	LinkType,
	LOGS_FOLDER,
	MatchMode,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { RuntimeConfig } from "./runtimeConfig.js";

const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

export interface FileConfig {
	action?: Action;
	pconfigVersion?: number;
	delay?: number;
	includeSingleEpisodes?: boolean;
	outputDir?: string;
	injectDir?: string;
	ignoreTitles?: boolean;
	includeNonVideos?: boolean;
	seasonFromEpisodes?: number;
	fuzzySizeThreshold?: number;
	excludeOlder?: string;
	excludeRecentSearch?: string;
	useClientTorrents?: boolean;
	dataDirs?: string[];
	matchMode?: MatchMode;
	skipRecheck?: boolean;
	autoResumeMaxDownload?: number;
	ignoreNonRelevantFilesToResume?: boolean;
	linkDir?: string;
	linkDirs?: string[];
	linkType?: string;
	flatLinking?: boolean;
	maxDataDepth?: number;
	linkCategory?: string;
	torrentDir?: string;
	torznab?: string[];
	torrentClients?: string[];
	qbittorrentUrl?: string;
	rtorrentRpcUrl?: string;
	transmissionRpcUrl?: string;
	delugeRpcUrl?: string;
	duplicateCategories?: boolean;
	notificationWebhookUrls?: string[];
	notificationWebhookUrl?: string;
	port?: number;
	host?: string;
	searchCadence?: string;
	rssCadence?: string;
	snatchTimeout?: string;
	searchTimeout?: string;
	searchLimit?: number;
	blockList?: string[];
	apiKey?: string;
	sonarr?: string[];
	radarr?: string[];
}

export const UNPARSABLE_CONFIG_MESSAGE = `
Your config file is improperly formatted. The location of the error is above, \
but you may have to look backwards to see the root cause.
Make sure that
  - strings (words, URLs, etc) are wrapped in "quotation marks"
  - any arrays (lists of things, even one thing) are wrapped in [square brackets]
  - every entry has a comma after it, including inside arrays
`.trim();

/**
 * Returns the appDir relevant to the OS/Environment. Due to initialization of
 * the SQLiteDB during read of db.ts - will need to create appDir in this function if
 * it does not exist (ENOENT)
 *
 * @return a string representing the absolute path to cross-seed config directory
 */
export function appDir(): string {
	const appDir =
		process.env.CONFIG_DIR ||
		(process.platform === "win32"
			? path.resolve(process.env.LOCALAPPDATA!, packageDotJson.name)
			: path.resolve(process.env.HOME!, `.${packageDotJson.name}`));
	try {
		accessSync(appDir, constants.R_OK | constants.W_OK);
	} catch (e) {
		if (e.code === "ENOENT") {
			mkdirSync(appDir, { recursive: true });
			return appDir;
		}
		const dockerMessage =
			process.env.DOCKER_ENV === "true"
				? ` Use chown to set the owner to ${process.getuid!()}:${process.getgid!()}`
				: "";
		throw new CrossSeedError(
			`cross-seed does not have R/W permissions on your config directory.${dockerMessage}`,
		);
	}
	return appDir;
}

export function createAppDirHierarchy(): void {
	const appDirPath = appDir();
	mkdirSync(path.join(appDirPath, TORRENT_CACHE_FOLDER), { recursive: true });
	mkdirSync(path.join(appDirPath, LOGS_FOLDER), { recursive: true });
}

export function getDefaultRuntimeConfig(): RuntimeConfig {
	return {
		delay: 30,
		torznab: [],
		useClientTorrents: true,
		dataDirs: [],
		matchMode: MatchMode.FLEXIBLE,
		skipRecheck: true,
		autoResumeMaxDownload: 52_428_800,
		ignoreNonRelevantFilesToResume: false,
		linkDirs: [],
		linkType: LinkType.HARDLINK,
		flatLinking: false,
		maxDataDepth: 2,
		linkCategory: "cross-seed-link",
		outputDir: path.join(appDir(), "cross-seeds"),
		ignoreTitles: false,
		includeSingleEpisodes: false,
		verbose: false,
		includeNonVideos: false,
		seasonFromEpisodes: 1,
		fuzzySizeThreshold: 0.02,
		excludeOlder: ms("2 weeks"),
		excludeRecentSearch: ms("3 days"),
		action: Action.INJECT,
		torrentClients: [],
		duplicateCategories: false,
		notificationWebhookUrls: [],
		torrents: [],
		port: 2468,
		host: "0.0.0.0",
		basePath: "",
		searchCadence: ms("1 day"),
		rssCadence: ms("30 minutes"),
		snatchTimeout: ms("30 seconds"),
		searchTimeout: ms("2 minutes"),
		searchLimit: 400,
		blockList: [],
		sonarr: [],
		radarr: [],
	};
}

export function applyDefaults(
	overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
	const merged = getDefaultRuntimeConfig();
	for (const key of Object.keys(overrides) as (keyof RuntimeConfig)[]) {
		const value = overrides[key];
		if (value === undefined) continue;
		(merged as unknown as Record<string, unknown>)[key as string] =
			structuredClone(value);
	}

	return merged;
}

export function stripDefaults(
	config: Partial<RuntimeConfig> | RuntimeConfig,
): Partial<RuntimeConfig> {
	const defaults = getDefaultRuntimeConfig();
	const overrides: Partial<RuntimeConfig> = {};
	for (const key of Object.keys(config) as (keyof RuntimeConfig)[]) {
		const value = config[key];
		if (value === undefined) continue;
		if (
			!(key in defaults) ||
			!isDeepStrictEqual(value, defaults[key as keyof RuntimeConfig])
		) {
			(overrides as unknown as Record<string, unknown>)[key as string] =
				structuredClone(value);
		}
	}

	return overrides;
}

export function prepareLegacyFileConfig(fileConfig: FileConfig): FileConfig {
	const normalized = { ...fileConfig };
	if (normalized.linkType === undefined) {
		normalized.linkType = LinkType.SYMLINK;
	}
	return normalized;
}

export async function getFileConfig(): Promise<FileConfig> {
	const configPath = path.join(appDir(), "config.js");

	try {
		return (await import(pathToFileURL(configPath).toString())).default;
	} catch (e) {
		if (e.code === "ERR_MODULE_NOT_FOUND") {
			return {};
		} else if (e instanceof SyntaxError) {
			const location = e.stack!.split("\n").slice(0, 3).join("\n");
			throw new CrossSeedError(
				`\n${chalk.red(location)}\n\n${UNPARSABLE_CONFIG_MESSAGE}`,
			);
		} else {
			throw e;
		}
	}
}
