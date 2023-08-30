import { Action, LinkType, MatchMode } from "./constants.js";
import { getProwlarrIndexers } from "./prowlarr.js";

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

export async function setRuntimeConfig(configObj: RuntimeConfig): Promise<void> {
	const prowlarrIndexers = await getProwlarrIndexers();
	configObj.torznab = configObj.torznab || [];
	if (prowlarrIndexers) {
		configObj.torznab = [...configObj.torznab,
			...prowlarrIndexers];
	}
	runtimeConfig = configObj;
}

export function getRuntimeConfig(): RuntimeConfig {
	return runtimeConfig;
}
