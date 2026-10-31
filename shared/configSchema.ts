import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";

export const WebhookObjectSchema = z.object({
	url: z.string().url(),
	payload: z.record(z.string(), z.unknown()).optional(),
	headers: z.record(z.string(), z.string()).optional(),
});

export type WebhookEntry = string | z.infer<typeof WebhookObjectSchema>;

export const RUNTIME_CONFIG_SCHEMA = z.object({
	delay: z
		.number()
		.int()
		.min(30)
		.max(3600)
		.describe("Delay between searches, in seconds (30\u20133600)."),
	torznab: z.array(z.string()),
	useClientTorrents: z
		.boolean()
		.describe(
			"Index existing content reported by connected torrent clients.",
		),
	dataDirs: z
		.array(z.string())
		.describe(
			"Directories containing existing media, as seen by cross-seed.",
		),
	matchMode: z
		.nativeEnum(MatchMode)
		.describe("How strictly candidate names and file sizes must match."),
	skipRecheck: z
		.boolean()
		.describe(
			"Skip full-match rechecks when supported; partial matches still require a recheck.",
		),
	autoResumeMaxDownload: z
		.number()
		.int()
		.min(0)
		.max(52_428_800)
		.describe(
			"Maximum missing data to download when resuming a partial match, in bytes (up to 50 MiB).",
		),
	ignoreNonRelevantFilesToResume: z
		.boolean()
		.describe(
			"Ignore non-media files when calculating missing data for resume.",
		),
	linkDirs: z
		.array(z.string())
		.describe(
			"Directories where cross-seed creates links for matched content.",
		),
	linkType: z
		.nativeEnum(LinkType)
		.describe("Filesystem method used to create links."),
	flatLinking: z
		.boolean()
		.describe("Create links directly within each link directory."),
	injectInPlaceWithoutLinkDir: z
		.boolean()
		.describe(
			"Inject perfect matches in place, without a link, when no linkDir shares a drive with their data.",
		),
	maxDataDepth: z
		.number()
		.int()
		.min(1)
		.describe(
			"Maximum depth to scan within each data directory (at least 1).",
		),
	linkCategory: z
		.string()
		.optional()
		.describe(
			"Category assigned to linked cross-seeds in the torrent client.",
		),
	torrentDir: z
		.string()
		.optional()
		.describe(
			"Directory containing exported torrent files; unset to disable this source.",
		),
	outputDir: z.string().describe("Directory for saved torrent files."),
	injectDir: z
		.string()
		.optional()
		.describe("Directory containing torrent files to inject."),
	ignoreTitles: z
		.boolean()
		.optional()
		.describe("Allow matching without comparing release titles."),
	includeSingleEpisodes: z
		.boolean()
		.describe("Include individual episodes when searching."),
	verbose: z.boolean().describe("Enable verbose logging."),
	includeNonVideos: z
		.boolean()
		.describe("Include content that is not video."),
	seasonFromEpisodes: z
		.number()
		.min(0)
		.max(1)
		.optional()
		.describe(
			"Minimum fraction of a season available from episode files (0\u20131).",
		),
	fuzzySizeThreshold: z
		.number()
		.gt(0)
		.lte(1)
		.describe(
			"Allowed size difference as a fraction (greater than 0, at most 1).",
		),
	excludeOlder: z
		.number()
		.optional()
		.describe("Skip older sources after this age, in milliseconds."),
	excludeRecentSearch: z
		.number()
		.optional()
		.describe(
			"Wait this many milliseconds before searching a source again.",
		),
	action: z
		.nativeEnum(Action)
		.describe(
			"Whether to save matched torrent files or inject them into a client.",
		),
	torrentClients: z
		.array(z.string())
		.describe("Torrent client connection URLs."),
	duplicateCategories: z
		.boolean()
		.describe("Retain source categories using cross-seed category naming."),
	notificationWebhookUrls: z.array(
		z.union([z.string(), WebhookObjectSchema]),
	),
	torrents: z
		.array(z.string())
		.describe("Explicit torrent file paths for commands that accept them."),
	port: z
		.number()
		.int()
		.min(1)
		.max(65535)
		.optional()
		.describe(
			"HTTP listening port (1\u201365535); requires daemon restart.",
		),
	host: z
		.string()
		.optional()
		.describe("HTTP listening address; requires daemon restart."),
	basePath: z
		.string()
		.optional()
		.describe("HTTP URL prefix; requires daemon restart."),
	searchCadence: z
		.number()
		.optional()
		.describe("Automatic search interval, in milliseconds."),
	rssCadence: z
		.number()
		.optional()
		.describe("RSS polling interval, in milliseconds."),
	snatchTimeout: z
		.number()
		.optional()
		.describe("Torrent download timeout, in milliseconds."),
	searchTimeout: z
		.number()
		.optional()
		.describe("Indexer search timeout, in milliseconds."),
	searchLimit: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			"Maximum unique search queries per indexer per run (0 for unlimited).",
		),
	blockList: z
		.array(z.string())
		.describe(
			"Release names, hashes or tracker values excluded from matching.",
		),
	apiKey: z
		.string()
		.min(24)
		.optional()
		.describe("API credential, at least 24 characters; sensitive."),
	sonarr: z.array(z.string()).describe("Sonarr connection URLs."),
	radarr: z.array(z.string()).describe("Radarr connection URLs."),
});

export type RuntimeConfig = z.infer<typeof RUNTIME_CONFIG_SCHEMA>;

export const RUNTIME_CONFIG_OVERRIDES_SCHEMA = RUNTIME_CONFIG_SCHEMA.partial();

export type RuntimeConfigOverrides = z.infer<
	typeof RUNTIME_CONFIG_OVERRIDES_SCHEMA
>;

export function parseRuntimeConfig(config: unknown): RuntimeConfig {
	return RUNTIME_CONFIG_SCHEMA.parse(config);
}

export function parseRuntimeConfigOverrides(
	config: unknown,
): Partial<RuntimeConfig> {
	return RUNTIME_CONFIG_OVERRIDES_SCHEMA.parse(config);
}
