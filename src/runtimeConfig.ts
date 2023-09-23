import { Action, LinkType, MatchMode } from "./constants.js";

export interface RuntimeConfig {
	offset: number;
	delay: number;
	torznab: string[];
	dataDirs: string[];
	matchMode: MatchMode;
	linkDir: string;
	linkType: LinkType;
	skipRecheck: boolean;
	maxDataDepth: number;
	dataCategory: string;
	torrentDir: string;
	outputDir: string;
	includeEpisodes: boolean;
	includeSeasonPackEpisodes: boolean;
	verbose: boolean;
	includeNonVideos: boolean;
	fuzzySizeThreshold: number;
	excludeOlder: number;
	excludeRecentSearch: number;
	action: Action;
	rtorrentRpcUrl: string;
	qbittorrentUrl: string;
	transmissionRpcUrl: string;
	duplicateCategories: boolean;
	notificationWebhookUrl: string;
	torrents: string[];
	port: number | false | null;
	searchCadence: number;
	rssCadence: number;
	snatchTimeout: number;
	searchTimeout: number;
	searchLimit: number;
}

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(): RuntimeConfig {
	return runtimeConfig;
}
