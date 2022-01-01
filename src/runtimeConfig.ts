import { Action } from "./constants.js";
interface RuntimeConfig {
	offset: number;
	jackettServerUrl: string;
	jackettApiKey: string;
	delay: number;
	trackers: string[];
	torznab: string[];
	torrentDir: string;
	outputDir: string;
	includeEpisodes: boolean;
	verbose: boolean;
	searchAll: boolean;
	fuzzySizeThreshold: number;
	excludeOlder: number;
	excludeRecentSearch: number;
	action: Action;
	rtorrentRpcUrl: string;
	qbittorrentUrl: string;
	notificationWebhookUrl: string;
}

export interface NonceOptions {
	trackers: string[];
	outputDir: string;
}

export const EmptyNonceOptions = {
	trackers: undefined,
	outputDir: undefined,
};

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(): RuntimeConfig {
	return runtimeConfig;
}
