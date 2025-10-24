import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";
import { RuntimeConfig } from "./runtimeConfig.js";

export const RUNTIME_CONFIG_SCHEMA = z
	.object({
		delay: z.number().int().min(30).max(3600),
		torznab: z.array(z.string()),
		useClientTorrents: z.boolean(),
		dataDirs: z.array(z.string()),
		matchMode: z.nativeEnum(MatchMode),
		skipRecheck: z.boolean(),
		autoResumeMaxDownload: z
			.number()
			.int()
			.min(0)
			.max(52_428_800),
		ignoreNonRelevantFilesToResume: z.boolean(),
		linkDirs: z.array(z.string()),
		linkType: z.nativeEnum(LinkType),
		flatLinking: z.boolean(),
		maxDataDepth: z.number().int().min(1),
		linkCategory: z.string().optional(),
		torrentDir: z.string().optional(),
		outputDir: z.string(),
		injectDir: z.string().optional(),
		ignoreTitles: z.boolean().optional(),
		includeSingleEpisodes: z.boolean(),
		verbose: z.boolean(),
		includeNonVideos: z.boolean(),
		seasonFromEpisodes: z.number().min(0).max(1).optional(),
		fuzzySizeThreshold: z.number().gt(0).lte(1),
		excludeOlder: z.number().optional(),
		excludeRecentSearch: z.number().optional(),
		action: z.nativeEnum(Action),
		torrentClients: z.array(z.string()),
		duplicateCategories: z.boolean(),
		notificationWebhookUrls: z.array(z.string()),
		torrents: z.array(z.string()),
		port: z.number().int().min(1).max(65535).optional(),
		host: z.string().optional(),
		basePath: z.string().optional(),
		searchCadence: z.number().optional(),
		rssCadence: z.number().optional(),
		snatchTimeout: z.number().optional(),
		searchTimeout: z.number().optional(),
		searchLimit: z.number().int().min(0).optional(),
		blockList: z.array(z.string()),
		apiKey: z.string().min(24).optional(),
		sonarr: z.array(z.string()),
		radarr: z.array(z.string()),
	})
	.superRefine((config, ctx) => {
		if (
			config.action === Action.INJECT &&
			!config.torrentClients.some((client) => !client.includes(":readonly:"))
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["torrentClients"],
				message:
					"At least one writable torrent client is required for action 'inject'",
			});
		}
	});

export function parseRuntimeConfig(config: unknown): RuntimeConfig {
	return RUNTIME_CONFIG_SCHEMA.parse(config);
}
