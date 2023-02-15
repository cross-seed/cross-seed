import { Action } from "./constants.js";
export interface RuntimeConfig {
	offset: number;
	delay: number;
	torznab: string[];
	dataDirs: string[];
	dataMode: string;
	dataCategory: string;
	torrentDir: string;
	outputDir: string;
	includeEpisodes: boolean;
	verbose: boolean;
	includeNonVideos: boolean;
	fuzzySizeThreshold: number;
	excludeOlder: number;
	excludeRecentSearch: number;
	action: Action;
	rtorrentRpcUrl: string;
	qbittorrentUrl: string;
	duplicateCategories: boolean;
	notificationWebhookUrl: string;
	torrents: string[];
	port: number | false | null;
	searchCadence: number;
	rssCadence: number;
}

export interface NonceOptions {
	torznab: string[];
	outputDir: string;
}

export const EmptyNonceOptions = {
	torznab: undefined,
	outputDir: undefined,
};

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(): RuntimeConfig {
	return runtimeConfig;
}
