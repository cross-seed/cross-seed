import { formatAsList } from "./utils";

export enum Action {
	SAVE = "save",
	INJECT = "inject",
}

export enum MatchMode {
	STRICT = "strict",
	FLEXIBLE = "flexible",
	PARTIAL = "partial",
}

export enum LinkType {
	SYMLINK = "symlink",
	HARDLINK = "hardlink",
	// REFLINK = "reflink",
}

export enum BlocklistType {
	NAME = "name",
	NAME_REGEX = "nameRegex",
	FOLDER = "folder",
	FOLDER_REGEX = "folderRegex",
	CATEGORY = "category",
	TAG = "tag",
	TRACKER = "tracker",
	INFOHASH = "infoHash",
	SIZE_BELOW = "sizeBelow",
	SIZE_ABOVE = "sizeAbove",
	LEGACY = "legacy",
}
export const NEWLINE_INDENT = "\n\t\t\t\t";

/**
 * error messages and map returned upon Zod validation failure
 */
export const ZodErrorMessages = {
	blocklistType: `Blocklist item does not start with a valid prefix. Must be of ${formatAsList(Object.values(BlocklistType), { sort: false, style: "narrow", type: "unit" })}`,
	blocklistEmptyValue: `Blocklist item must have a value after the colon.`,
	blocklistRegex: `Blocklist regex is not a valid regex.`,
	blocklistFolder: `Blocklist folder must not contain path separators`,
	blocklistTracker: `Blocklist tracker is not a valid URL host. If URL is https://user:pass@tracker.example.com:8080/announce/key, you must use "tracker:tracker.example.com:8080"`,
	blocklistHash: `Blocklist hash must be 40 characters and alphanumeric`,
	blocklistSize: `Blocklist size must be an integer for the number of bytes. You can only have one sizeBelow, one sizeAbove, and sizeBelow <= sizeAbove.`,
	blocklistNeedsClient: `Blocklist ${BlocklistType.CATEGORY}:, ${BlocklistType.TAG}:, and ${BlocklistType.TRACKER}: requires torrentDir or useClientTorrents.`,
	blocklistNeedsDataDirs: `Blocklist ${BlocklistType.FOLDER}: and ${BlocklistType.FOLDER_REGEX}: only applies to searchees from dataDirs.`,
	vercel: "format does not follow vercel's `ms` style ( https://github.com/vercel/ms#examples )",
	emptyString:
		"cannot have an empty string. If you want to unset it, use null or undefined.",
	delayNegative: "delay is in seconds, you can't travel back in time.",
	delayUnsupported: `delay must be 30 seconds to 1 hour.${NEWLINE_INDENT}To even out search loads please see the following documentation:${NEWLINE_INDENT}(https://www.cross-seed.org/docs/basics/options#delay)`,
	rssCadenceUnsupported: "rssCadence must be 10-120 minutes",
	searchCadenceUnsupported: "searchCadence must be at least 1 day.",
	searchCadenceExcludeRecent:
		"excludeRecentSearch must be at least 3x searchCadence.",
	excludeRecentOlder:
		"excludeOlder and excludeRecentSearch must be defined for searching. excludeOlder must be 2-5x excludeRecentSearch.",
	injectNeedsInjectMode: "`cross-seed inject` requires the 'inject' action.",
	autoResumeMaxDownloadUnsupported:
		"autoResumeMaxDownload must be an integer of bytes between between 0 and 52428800 (50 MiB).",
	numberMustBeRatio:
		"fuzzySizeThreshold and seasonFromEpisodes must be between 0 and 1.",
	fuzzySizeThresholdMax:
		"fuzzySizeThreshold cannot be greater than 0.1 when using searchCadence or rssCadence.",
	seasonFromEpisodesMin:
		"seasonFromEpisodes cannot be less than 0.5 when using searchCadence or rssCadence",
	injectUrl:
		"You need to specify rtorrentRpcUrl, transmissionRpcUrl, qbittorrentUrl, or delugeRpcUrl when using 'inject'",
	qBitAutoTMM:
		"If using Automatic Torrent Management in qBittorrent, please read: https://www.cross-seed.org/docs/v6-migration#new-folder-structure-for-links",
	includeSingleEpisodes:
		"includeSingleEpisodes is not recommended when using announce, please read: https://www.cross-seed.org/docs/v6-migration#updated-includesingleepisodes-behavior",
	invalidOutputDir:
		"outputDir should only contain .torrent files, cross-seed will populate and manage (https://www.cross-seed.org/docs/basics/options#outputdir)",
	torrentDirAndUseClientTorrents:
		"You cannot have both torrentDir and useClientTorrents.",
	needsClient: "You need to have a client configured for useClientTorrents.",
	needSearchees:
		"You need to have torrentDir, useClientTorrents or dataDirs for search/rss/announce matching to work.",
	matchModeInvalid: `matchMode must be one of: ${formatAsList(
		Object.values(MatchMode).map((m) => `"${m}"`),
		{ sort: false, style: "narrow", type: "unit" },
	)}`,
	matchModeNeedsLinkDirs: `When using action: "inject", you need to set linkDirs for flexible and partial matchMode (https://www.cross-seed.org/docs/tutorials/linking). If you cannot use linking, use matchMode: "strict"`,
	ensembleNeedsClient:
		"seasonFromEpisodes requires a torrent client to connect to when using torrentDir or useClientTorrents.",
	ensembleNeedsLinkDirs:
		"When using action 'inject', you need to set linkDirs for seasonFromEpisodes (https://www.cross-seed.org/docs/tutorials/linking). If you cannot use linking, disable this option by using seasonFromEpisodes: null",
	ensembleNeedsPartial:
		"seasonFromEpisodes requires matchMode partial if enabled and value is below 1.",
	linkDirsInOtherDirs:
		"You cannot have your linkDirs inside of your torrentDir/dataDirs/outputDir. Please adjust your paths to correct this.",
	dataDirsInOtherDirs:
		"You cannot have your dataDirs inside of your torrentDir/linkDirs/outputDir. Please adjust your paths to correct this.",
	torrentDirInOtherDirs:
		"You cannot have your torrentDir inside of your dataDirs/linkDirs/outputDir. Please adjust your paths to correct this.",
	outputDirInOtherDirs:
		"You cannot have your outputDir inside of your torrentDir/dataDirs/linkDirs. Please adjust your paths to correct this.",
	relativePaths:
		"Absolute paths for torrentDir, linkDirs, dataDirs, and outputDir are recommended.",
};

/**
 * Default config values
 */
export const defaultConfig = {
	delay: 30,
	torznab: [""],
	useClientTorrents: false,
	dataDirs: [""],
	matchMode: MatchMode.STRICT,
	skipRecheck: true,
	autoResumeMaxDownload: 52428800,
	linkCategory: null,
	linkDir: null,
	linkDirs: [""],
	linkType: LinkType.HARDLINK,
	flatLinking: false,
	maxDataDepth: 2,
	torrentDir: null,
	outputDir: "",
	injectDir: "",
	includeSingleEpisodes: false,
	includeNonVideos: false,
	fuzzySizeThreshold: 1,
	seasonFromEpisodes: null,
	excludeOlder: null,
	excludeRecentSearch: null,
	action: Action.INJECT,
	qbittorrentUrl: null,
	rtorrentRpcUrl: null,
	transmissionRpcUrl: null,
	delugeRpcUrl: null,
	duplicateCategories: false,
	notificationWebhookUrls: [""],
	notificationWebhookUrl: null,
	port: null,
	host: null,
	rssCadence: null,
	searchCadence: null,
	snatchTimeout: null,
	searchTimeout: null,
	searchLimit: null,
	verbose: false,
	torrents: [""],
	blockList: [""],
	apiKey: null,
	radarr: [""],
	sonarr: [""],
};
