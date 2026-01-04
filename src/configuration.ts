import { accessSync, constants, mkdirSync } from "fs";
import { createRequire } from "module";
import ms from "ms";
import { isDeepStrictEqual } from "node:util";
import path from "path";
import { pathToFileURL } from "url";
import {
	Action,
	LinkType,
	LOGS_FOLDER,
	MatchMode,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { RuntimeConfig } from "./runtimeConfig.js";
import { omitUndefined } from "./utils/object.js";

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

export function stripDefaults(
	config: Partial<RuntimeConfig> | RuntimeConfig,
): Partial<RuntimeConfig> {
	const defaults = getDefaultRuntimeConfig();
	const overrides: Partial<RuntimeConfig> = {};
	const overridesWritable = overrides as Record<keyof RuntimeConfig, unknown>;
	for (const [key, value] of Object.entries(config) as [
		keyof RuntimeConfig,
		RuntimeConfig[keyof RuntimeConfig],
	][]) {
		if (value === undefined) continue;
		if (!(key in defaults) || !isDeepStrictEqual(value, defaults[key])) {
			overridesWritable[key] = structuredClone(value);
		}
	}

	return overrides;
}

export function transformFileConfig(
	fileConfig: FileConfig,
): Partial<RuntimeConfig> {
	const result: Partial<RuntimeConfig> = {};

	if (typeof fileConfig.delay === "number") {
		result.delay = fileConfig.delay;
	}

	if (isStringArray(fileConfig.torznab)) {
		result.torznab = fileConfig.torznab;
	}

	if (typeof fileConfig.useClientTorrents === "boolean") {
		result.useClientTorrents = fileConfig.useClientTorrents;
	}

	if (isStringArray(fileConfig.dataDirs)) {
		result.dataDirs = fileConfig.dataDirs;
	}

	if (
		fileConfig.matchMode === MatchMode.STRICT ||
		fileConfig.matchMode === MatchMode.FLEXIBLE ||
		fileConfig.matchMode === MatchMode.PARTIAL
	) {
		result.matchMode = fileConfig.matchMode;
	} else if (fileConfig.matchMode === "risky") {
		result.matchMode = MatchMode.FLEXIBLE;
	}

	if (typeof fileConfig.skipRecheck === "boolean") {
		result.skipRecheck = fileConfig.skipRecheck;
	}

	if (typeof fileConfig.autoResumeMaxDownload === "number") {
		result.autoResumeMaxDownload = fileConfig.autoResumeMaxDownload;
	}

	if (typeof fileConfig.ignoreNonRelevantFilesToResume === "boolean") {
		result.ignoreNonRelevantFilesToResume =
			fileConfig.ignoreNonRelevantFilesToResume;
	}

	const linkDirs = resolveLinkDirs(fileConfig);
	if (linkDirs) {
		result.linkDirs = linkDirs;
	}

	if (
		fileConfig.linkType === LinkType.SYMLINK ||
		fileConfig.linkType === LinkType.HARDLINK ||
		fileConfig.linkType === LinkType.REFLINK ||
		fileConfig.linkType === LinkType.REFLINK_OR_COPY
	) {
		result.linkType = fileConfig.linkType;
	} else if (fileConfig.linkType === undefined && linkDirs?.length) {
		result.linkType = LinkType.SYMLINK;
	}

	if (typeof fileConfig.flatLinking === "boolean") {
		result.flatLinking = fileConfig.flatLinking;
	}

	if (typeof fileConfig.maxDataDepth === "number") {
		result.maxDataDepth = fileConfig.maxDataDepth;
	}

	if (typeof fileConfig.linkCategory === "string") {
		result.linkCategory = fileConfig.linkCategory;
	}

	if (typeof fileConfig.torrentDir === "string") {
		result.torrentDir = fileConfig.torrentDir;
	}

	if (typeof fileConfig.outputDir === "string") {
		result.outputDir = fileConfig.outputDir;
	}

	if (typeof fileConfig.injectDir === "string") {
		result.injectDir = fileConfig.injectDir;
	}

	if (typeof fileConfig.ignoreTitles === "boolean") {
		result.ignoreTitles = fileConfig.ignoreTitles;
	}

	if (typeof fileConfig.includeSingleEpisodes === "boolean") {
		result.includeSingleEpisodes = fileConfig.includeSingleEpisodes;
	}

	if (typeof fileConfig.includeNonVideos === "boolean") {
		result.includeNonVideos = fileConfig.includeNonVideos;
	}

	const seasonFromEpisodes = normalizeSeasonFromEpisodes(
		fileConfig.seasonFromEpisodes,
	);
	if (seasonFromEpisodes !== undefined) {
		result.seasonFromEpisodes = seasonFromEpisodes;
	}

	if (typeof fileConfig.fuzzySizeThreshold === "number") {
		result.fuzzySizeThreshold = fileConfig.fuzzySizeThreshold;
	}

	const excludeOlder = parseDurationValue(fileConfig.excludeOlder);
	if (excludeOlder !== undefined) {
		result.excludeOlder = excludeOlder;
	}

	const excludeRecentSearch = parseDurationValue(
		fileConfig.excludeRecentSearch,
	);
	if (excludeRecentSearch !== undefined) {
		result.excludeRecentSearch = excludeRecentSearch;
	}

	if (
		fileConfig.action === Action.SAVE ||
		fileConfig.action === Action.INJECT
	) {
		result.action = fileConfig.action;
	}

	const torrentClients = collectTorrentClients(fileConfig);
	if (torrentClients) {
		result.torrentClients = torrentClients;
	}

	if (typeof fileConfig.duplicateCategories === "boolean") {
		result.duplicateCategories = fileConfig.duplicateCategories;
	}

	const webhookUrls = collectWebhookUrls(fileConfig);
	if (webhookUrls) {
		result.notificationWebhookUrls = webhookUrls;
	}

	if (typeof fileConfig.port === "number") {
		result.port = fileConfig.port;
	}

	if (typeof fileConfig.host === "string") {
		result.host = fileConfig.host;
	}

	const searchCadence = parseDurationValue(fileConfig.searchCadence);
	if (searchCadence !== undefined) {
		result.searchCadence = searchCadence;
	}

	const rssCadence = parseDurationValue(fileConfig.rssCadence);
	if (rssCadence !== undefined) {
		result.rssCadence = rssCadence;
	}

	const snatchTimeout = parseDurationValue(fileConfig.snatchTimeout);
	if (snatchTimeout !== undefined) {
		result.snatchTimeout = snatchTimeout;
	}

	const searchTimeout = parseDurationValue(fileConfig.searchTimeout);
	if (searchTimeout !== undefined) {
		result.searchTimeout = searchTimeout;
	}

	if (typeof fileConfig.searchLimit === "number") {
		result.searchLimit = fileConfig.searchLimit;
	}

	if (isStringArray(fileConfig.blockList)) {
		result.blockList = fileConfig.blockList;
	}

	if (typeof fileConfig.apiKey === "string") {
		result.apiKey = fileConfig.apiKey;
	}

	if (isStringArray(fileConfig.sonarr)) {
		result.sonarr = fileConfig.sonarr;
	}

	if (isStringArray(fileConfig.radarr)) {
		result.radarr = fileConfig.radarr;
	}

	return omitUndefined(result);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function normalizeSeasonFromEpisodes(value: unknown): number | undefined {
	if (value === null || value === false) return 0;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
}

function parseDurationValue(value: unknown): number | undefined {
	if (value === null) return 0;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = ms(value);
		if (typeof parsed === "number" && Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function resolveLinkDirs(fileConfig: FileConfig): string[] | undefined {
	if (isStringArray(fileConfig.linkDirs) && fileConfig.linkDirs.length) {
		return fileConfig.linkDirs;
	}
	if (typeof fileConfig.linkDir === "string") {
		return [fileConfig.linkDir];
	}
	return undefined;
}

function collectTorrentClients(fileConfig: FileConfig): string[] | undefined {
	const clients = new Set<string>();
	if (isStringArray(fileConfig.torrentClients)) {
		fileConfig.torrentClients.forEach((client) => clients.add(client));
	}
	addClient(clients, "qbittorrent", fileConfig.qbittorrentUrl);
	addClient(clients, "rtorrent", fileConfig.rtorrentRpcUrl);
	addClient(clients, "transmission", fileConfig.transmissionRpcUrl);
	addClient(clients, "deluge", fileConfig.delugeRpcUrl);
	return clients.size ? Array.from(clients) : undefined;
}

function addClient(clients: Set<string>, prefix: string, url: unknown): void {
	if (typeof url === "string") {
		clients.add(`${prefix}:${url}`);
	}
}

function collectWebhookUrls(fileConfig: FileConfig): string[] | undefined {
	const urls = new Set<string>();
	if (isStringArray(fileConfig.notificationWebhookUrls)) {
		fileConfig.notificationWebhookUrls.forEach((url) => {
			if (typeof url === "string") urls.add(url);
		});
	}
	if (typeof fileConfig.notificationWebhookUrl === "string") {
		urls.add(fileConfig.notificationWebhookUrl);
	}
	return urls.size ? Array.from(urls) : undefined;
}

export async function getFileConfig(): Promise<FileConfig | undefined> {
	const configPath = path.join(appDir(), "config.js");

	try {
		return (await import(pathToFileURL(configPath).toString())).default;
	} catch (e) {
		if (e.code === "ERR_MODULE_NOT_FOUND") {
			return undefined;
		}
		throw e;
	}
}
