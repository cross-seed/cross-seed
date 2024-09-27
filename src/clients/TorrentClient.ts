import { Metafile } from "../parseTorrent.js";
import {
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	MatchMode,
	VIDEO_DISC_EXTENSIONS,
} from "../constants.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";
import Deluge from "./Deluge.js";
import { Result } from "../Result.js";
import { Label } from "../logger.js";
import ms from "ms";
import { hasExt } from "../utils.js";

let activeClient: TorrentClient | null = null;

export type TorrentClientType =
	| Label.QBITTORRENT
	| Label.RTORRENT
	| Label.TRANSMISSION
	| Label.DELUGE;

export interface TorrentMetadataInClient {
	infoHash: string;
	category: string;
	tags: string[];
	trackers?: string[][];
}

export interface TorrentClient {
	type: TorrentClientType;
	isTorrentComplete: (
		infoHash: string,
	) => Promise<Result<boolean, "NOT_FOUND">>;
	getAllTorrents: () => Promise<TorrentMetadataInClient[]>;
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
		decision: DecisionAnyMatch,
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

export function getClient(): TorrentClient | null {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}

export function shouldRecheck(
	searchee: Searchee,
	decision: DecisionAnyMatch,
): boolean {
	const { skipRecheck } = getRuntimeConfig();
	if (!skipRecheck) return true;
	if (decision === Decision.MATCH_PARTIAL) return true;
	if (!searchee.infoHash) return true;
	if (hasExt(searchee.files, VIDEO_DISC_EXTENSIONS)) return true;
	return false; // Skip for MATCH | MATCH_SIZE_ONLY
}

// Resuming partials
export function getMaxRemainingBytes(decision: DecisionAnyMatch) {
	const { matchMode, maxRemainingForResume } = getRuntimeConfig();
	if (decision !== Decision.MATCH_PARTIAL) return 0;
	if (matchMode !== MatchMode.PARTIAL) return 0;
	return maxRemainingForResume * 1024 * 1024;
}
export const resumeSleepTime = ms("15 seconds");
export const resumeErrSleepTime = ms("5 minutes");
export function getResumeStopTime() {
	return Date.now() + ms("1 hour");
}
