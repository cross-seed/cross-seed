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
import { omitUndefined } from "./utils.js";

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

export function transformFileConfig(
	fileConfig: FileConfig,
): Partial<RuntimeConfig> {
	const result: Partial<RuntimeConfig> = {};

	const delay = coerceNumber(fileConfig.delay);
	if (delay !== undefined) result.delay = delay;

	const torznab = toStringArray(fileConfig.torznab);
	if (torznab) result.torznab = torznab;

	const useClientTorrents = coerceBoolean(fileConfig.useClientTorrents);
	if (useClientTorrents !== undefined) result.useClientTorrents = useClientTorrents;

	const dataDirs = toStringArray(fileConfig.dataDirs);
	if (dataDirs) result.dataDirs = dataDirs;

	const matchMode = coerceMatchMode(fileConfig.matchMode);
	if (matchMode) result.matchMode = matchMode;

	const skipRecheck = coerceBoolean(fileConfig.skipRecheck);
	if (skipRecheck !== undefined) result.skipRecheck = skipRecheck;

	const autoResumeMaxDownload = coerceInt(fileConfig.autoResumeMaxDownload);
	if (autoResumeMaxDownload !== undefined)
		result.autoResumeMaxDownload = Math.max(0, autoResumeMaxDownload);

	const ignoreNonRelevantFilesToResume = coerceBoolean(
		fileConfig.ignoreNonRelevantFilesToResume,
	);
	if (ignoreNonRelevantFilesToResume !== undefined)
		result.ignoreNonRelevantFilesToResume = ignoreNonRelevantFilesToResume;

	const linkDirList = toStringArray(fileConfig.linkDirs) ??
		(fileConfig.linkDir ? [fileConfig.linkDir] : undefined);
	if (linkDirList) result.linkDirs = linkDirList;

	const linkType = coerceLinkType(fileConfig.linkType);
	if (linkType) result.linkType = linkType;
	else if (fileConfig.linkType === undefined && fileConfig.linkDir)
		result.linkType = LinkType.SYMLINK;

	const flatLinking = coerceBoolean(fileConfig.flatLinking);
	if (flatLinking !== undefined) result.flatLinking = flatLinking;

	const maxDataDepth = coerceInt(fileConfig.maxDataDepth);
	if (maxDataDepth !== undefined) result.maxDataDepth = maxDataDepth;

	const linkCategory = coerceString(fileConfig.linkCategory);
	if (linkCategory) result.linkCategory = linkCategory;

	const torrentDir = coerceString(fileConfig.torrentDir);
	if (torrentDir) result.torrentDir = torrentDir;

	const outputDir = coerceString(fileConfig.outputDir);
	if (outputDir) result.outputDir = outputDir;

	const injectDir = coerceString(fileConfig.injectDir);
	if (injectDir) result.injectDir = injectDir;

	const ignoreTitles = coerceBoolean(fileConfig.ignoreTitles);
	if (ignoreTitles !== undefined) result.ignoreTitles = ignoreTitles;

	const includeSingleEpisodes = coerceBoolean(
		fileConfig.includeSingleEpisodes,
	);
	if (includeSingleEpisodes !== undefined)
		result.includeSingleEpisodes = includeSingleEpisodes;

	const includeNonVideos = coerceBoolean(fileConfig.includeNonVideos);
	if (includeNonVideos !== undefined) result.includeNonVideos = includeNonVideos;

	const seasonFromEpisodes = coerceSeasonFromEpisodes(
		fileConfig.seasonFromEpisodes,
	);
	if (seasonFromEpisodes !== undefined)
		result.seasonFromEpisodes = seasonFromEpisodes;

	const fuzzySizeThreshold = coerceNumber(fileConfig.fuzzySizeThreshold);
	if (fuzzySizeThreshold !== undefined)
		result.fuzzySizeThreshold = fuzzySizeThreshold;

	const excludeOlder = coerceDuration(fileConfig.excludeOlder);
	if (excludeOlder !== undefined) result.excludeOlder = excludeOlder;

	const excludeRecentSearch = coerceDuration(
		fileConfig.excludeRecentSearch,
	);
	if (excludeRecentSearch !== undefined)
		result.excludeRecentSearch = excludeRecentSearch;

	const action = coerceAction(fileConfig.action);
	if (action) result.action = action;

	const torrentClients = new Set<string>();
	const configuredClients = toStringArray(fileConfig.torrentClients);
	if (configuredClients)
		configuredClients.forEach((client) => torrentClients.add(client));

	const qbittorrentUrl = coerceString(fileConfig.qbittorrentUrl);
	if (qbittorrentUrl)
		torrentClients.add(`qbittorrent:${qbittorrentUrl}`);
	const rtorrentRpcUrl = coerceString(fileConfig.rtorrentRpcUrl);
	if (rtorrentRpcUrl)
		torrentClients.add(`rtorrent:${rtorrentRpcUrl}`);
	const transmissionRpcUrl = coerceString(fileConfig.transmissionRpcUrl);
	if (transmissionRpcUrl)
		torrentClients.add(`transmission:${transmissionRpcUrl}`);
	const delugeRpcUrl = coerceString(fileConfig.delugeRpcUrl);
	if (delugeRpcUrl)
		torrentClients.add(`deluge:${delugeRpcUrl}`);

	if (torrentClients.size) {
		result.torrentClients = Array.from(torrentClients);
	}

	const duplicateCategories = coerceBoolean(fileConfig.duplicateCategories);
	if (duplicateCategories !== undefined)
		result.duplicateCategories = duplicateCategories;

	const webhookUrls = mergeUniqueStrings([
		toStringArray(fileConfig.notificationWebhookUrls),
		fileConfig.notificationWebhookUrl
			? [fileConfig.notificationWebhookUrl]
			: undefined,
	]);
	if (webhookUrls) result.notificationWebhookUrls = webhookUrls;

	const port = coerceInt(fileConfig.port);
	if (port !== undefined) result.port = port;

	const host = coerceString(fileConfig.host);
	if (host) result.host = host;

	const searchCadence = coerceDuration(fileConfig.searchCadence);
	if (searchCadence !== undefined) result.searchCadence = searchCadence;

	const rssCadence = coerceDuration(fileConfig.rssCadence);
	if (rssCadence !== undefined) result.rssCadence = rssCadence;

	const snatchTimeout = coerceDuration(fileConfig.snatchTimeout);
	if (snatchTimeout !== undefined) result.snatchTimeout = snatchTimeout;

	const searchTimeout = coerceDuration(fileConfig.searchTimeout);
	if (searchTimeout !== undefined) result.searchTimeout = searchTimeout;

	const searchLimit = coerceInt(fileConfig.searchLimit);
	if (searchLimit !== undefined) result.searchLimit = Math.max(0, searchLimit);

	const blockList = toStringArray(fileConfig.blockList);
	if (blockList) result.blockList = blockList;

	const apiKey = coerceString(fileConfig.apiKey);
	if (apiKey) result.apiKey = apiKey;

	const sonarr = toStringArray(fileConfig.sonarr);
	if (sonarr) result.sonarr = sonarr;

	const radarr = toStringArray(fileConfig.radarr);
	if (radarr) result.radarr = radarr;

	return omitUndefined(result) as Partial<RuntimeConfig>;
}

function coerceBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	if (typeof value === "number") {
		if (value === 1) return true;
		if (value === 0) return false;
	}
	return undefined;
}

function coerceNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length) {
		const parsed = Number(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return undefined;
}

function coerceInt(value: unknown): number | undefined {
	const num = coerceNumber(value);
	if (num === undefined) return undefined;
	const int = Math.trunc(num);
	return Number.isFinite(int) ? int : undefined;
}

function coerceDuration(value: unknown): number | undefined {
	if (value === null) return 0;
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length) {
		const parsed = ms(value.trim());
		if (typeof parsed === "number" && Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function coerceString(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}
	return undefined;
}

function toStringArray(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) {
		const arr = value
			.map((item) => coerceString(item))
			.filter((item): item is string => Boolean(item));
		return arr.length ? arr : [];
	}
	const single = coerceString(value);
	if (single) return [single];
	return undefined;
}

function coerceMatchMode(value: unknown): MatchMode | undefined {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "strict" || normalized === MatchMode.STRICT)
			return MatchMode.STRICT;
		if (
			normalized === "flexible" ||
			normalized === MatchMode.FLEXIBLE ||
			normalized === "risky"
		)
			return MatchMode.FLEXIBLE;
		if (normalized === "partial" || normalized === MatchMode.PARTIAL)
			return MatchMode.PARTIAL;
		if (normalized === "safe") return MatchMode.STRICT;
	}
	if (Object.values(MatchMode).includes(value as MatchMode)) {
		return value as MatchMode;
	}
	return undefined;
}

function coerceAction(value: unknown): Action | undefined {
	if (typeof value === "string") {
		switch (value.trim().toLowerCase()) {
			case Action.SAVE:
			case "save":
				return Action.SAVE;
			case Action.INJECT:
			case "inject":
				return Action.INJECT;
			default:
				return undefined;
		}
	}
	if (Object.values(Action).includes(value as Action)) {
		return value as Action;
	}
	return undefined;
}

function coerceLinkType(value: unknown): LinkType | undefined {
	if (typeof value === "string") {
		switch (value.trim().toLowerCase()) {
			case LinkType.SYMLINK:
			case "symlink":
				return LinkType.SYMLINK;
			case LinkType.HARDLINK:
			case "hardlink":
				return LinkType.HARDLINK;
			case LinkType.REFLINK:
			case "reflink":
				return LinkType.REFLINK;
			case LinkType.REFLINK_OR_COPY:
			case "reflinkorcopy":
			case "reflink_or_copy":
				return LinkType.REFLINK_OR_COPY;
			default:
				return undefined;
		}
	}
	if (Object.values(LinkType).includes(value as LinkType)) {
		return value as LinkType;
	}
	return undefined;
}

function coerceSeasonFromEpisodes(value: unknown): number | undefined {
	if (value === null || value === false) return 0;
	if (value === undefined) return undefined;
	const num = coerceNumber(value);
	if (num === undefined) return undefined;
	return num;
}

function mergeUniqueStrings(values: (string[] | undefined)[]): string[] | undefined {
	const combined = values.flatMap((arr) => (arr ? arr : []));
	const unique = Array.from(new Set(combined));
	return unique.length ? unique : undefined;
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
