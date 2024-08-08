import { Metafile } from "../parseTorrent.js";
import {
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	MatchMode,
} from "../constants.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";
import Deluge from "./Deluge.js";
import { Result } from "../Result.js";
import ms from "ms";

let activeClient: TorrentClient;

export interface TorrentClient {
	isTorrentComplete: (
		infoHash: string,
	) => Promise<Result<boolean, "NOT_FOUND">>;
	getDownloadDir: (
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	) => Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	>;
	getAllDownloadDirs: (options: {
		metas: SearcheeWithInfoHash[] | Metafile[];
		onlyCompleted: boolean;
	}) => Promise<Map<string, string>>;
	resumeInjection: (
		infoHash: string,
		options: { checkOnce: boolean },
	) => Promise<void>;
	inject: (
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		path?: string,
	) => Promise<InjectionResult>;
	recheckTorrent: (infoHash: string) => Promise<void>;
	validateConfig: () => Promise<void>;
}

function instantiateDownloadClient() {
	const { rtorrentRpcUrl, qbittorrentUrl, transmissionRpcUrl, delugeRpcUrl } =
		getRuntimeConfig();
	if (rtorrentRpcUrl) {
		activeClient = new RTorrent();
	} else if (qbittorrentUrl) {
		activeClient = new QBittorrent();
	} else if (transmissionRpcUrl) {
		activeClient = new Transmission();
	} else if (delugeRpcUrl) {
		activeClient = new Deluge();
	}
}

export function getClient(): TorrentClient {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}

export function shouldRecheck(searchee: Searchee, decision: Decision): boolean {
	const { matchMode } = getRuntimeConfig();
	if (matchMode === MatchMode.SAFE) return true; // Recheck then resume in safe mode
	if (!searchee.infoHash) return true; // Only infohash knows if it's complete
	switch (decision) {
		case Decision.MATCH:
		case Decision.MATCH_SIZE_ONLY:
			return false;
		case Decision.MATCH_PARTIAL:
		default:
			return true;
	}
}

// Resuming partials
export function getMaxRemainingBytes() {
	const { matchMode, maxRemainingForResume } = getRuntimeConfig();
	if (matchMode !== MatchMode.PARTIAL) return 0;
	return maxRemainingForResume * 1024 * 1024;
}
export const resumeSleepTime = ms("15 seconds");
export const resumeErrSleepTime = ms("5 minutes");
export function getResumeStopTime() {
	return Date.now() + ms("1 hour");
}
