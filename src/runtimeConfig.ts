import { Action, LinkType, MatchMode } from "./constants.js";
import { omitUndefined } from "./utils.js";

export interface RuntimeConfig {
	delay: number;
	torznab: string[];
	useClientTorrents: boolean;
	dataDirs: string[];
	matchMode: MatchMode;
	skipRecheck: boolean;
	autoResumeMaxDownload: number;
	ignoreNonRelevantFilesToResume: boolean;
	linkDirs: string[];
	linkType: LinkType;
	flatLinking: boolean;
	maxDataDepth: number;
	linkCategory?: string;
	torrentDir?: string;
	outputDir: string;
	injectDir?: string;
	ignoreTitles?: boolean;
	includeSingleEpisodes: boolean;
	verbose: boolean;
	includeNonVideos: boolean;
	seasonFromEpisodes?: number;
	fuzzySizeThreshold: number;
	excludeOlder?: number;
	excludeRecentSearch?: number;
	action: Action;
	torrentClients: string[];
	duplicateCategories: boolean;
	notificationWebhookUrls: string[];
	torrents: string[];
	port?: number;
	host?: string;
	basePath?: string;
	searchCadence?: number;
	rssCadence?: number;
	snatchTimeout?: number;
	searchTimeout?: number;
	searchLimit?: number;
	blockList: string[];
	apiKey?: string;
	sonarr: string[];
	radarr: string[];
}

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(
	configOverride: Partial<RuntimeConfig> = {},
): RuntimeConfig {
	return {
		...runtimeConfig,
		...omitUndefined(configOverride),
	};
}
