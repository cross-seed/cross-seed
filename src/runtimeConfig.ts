import { Action, LinkType, MatchMode } from "./constants.js";

export interface RuntimeConfig {
	delay: number;
	torznab: string[];
	dataDirs: string[];
	matchMode: MatchMode;
	linkDir: string;
	linkType: LinkType;
	legacyLinking: boolean;
	skipRecheck: boolean;
	maxDataDepth: number;
	dataCategory: string;
	torrentDir: string;
	outputDir: string;
	includeEpisodes: boolean;
	includeSingleEpisodes: boolean;
	verbose: boolean;
	includeNonVideos: boolean;
	fuzzySizeThreshold: number;
	excludeOlder?: number;
	excludeRecentSearch?: number;
	action: Action;
	rtorrentRpcUrl: string;
	qbittorrentUrl: string;
	transmissionRpcUrl: string;
	delugeRpcUrl: string;
	duplicateCategories: boolean;
	notificationWebhookUrl: string;
	torrents: string[];
	port: number | null;
	searchCadence?: number;
	rssCadence?: number;
	snatchTimeout?: number;
	searchTimeout?: number;
	searchLimit: number;
	blockList: string[];
	apiKey?: string;
}

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(): RuntimeConfig {
	return runtimeConfig;
}
