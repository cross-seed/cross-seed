import { Action, LinkType, MatchMode } from "./constants.js";

export interface RuntimeConfig {
	delay: number;
	torznab: string[];
	useClientTorrents: boolean;
	dataDirs: string[];
	matchMode: MatchMode;
	skipRecheck: boolean;
	autoResumeMaxDownload: number;
	linkDirs: string[];
	linkType: LinkType;
	flatLinking: boolean;
	maxDataDepth: number;
	linkCategory?: string;
	torrentDir?: string;
	outputDir: string;
	injectDir?: string;
	includeSingleEpisodes: boolean;
	verbose: boolean;
	includeNonVideos: boolean;
	seasonFromEpisodes?: number;
	fuzzySizeThreshold: number;
	excludeOlder?: number;
	excludeRecentSearch?: number;
	action: Action;
	rtorrentRpcUrl?: string;
	qbittorrentUrl?: string;
	transmissionRpcUrl?: string;
	delugeRpcUrl?: string;
	duplicateCategories: boolean;
	notificationWebhookUrls: string[];
	torrents: string[];
	port?: number;
	host?: string;
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
		...Object.fromEntries(
			Object.entries(configOverride).filter(([, v]) => v !== undefined),
		),
	};
}
