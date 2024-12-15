import path from "path";
import ms from "ms";
import { testLinking } from "../action.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { findBlockedStringInReleaseMaybe } from "../preFilter.js";
import { Result } from "../Result.js";
import {
	ABS_WIN_PATH_REGEX,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	MatchMode,
	VIDEO_DISC_EXTENSIONS,
} from "../constants.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import { wait } from "../utils.js";
import Deluge from "./Deluge.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";
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

export async function validateSavePaths(
	infoHashPathMap: Map<string, string>,
	searchees: SearcheeWithInfoHash[],
): Promise<void> {
	const { blockList, linkDir } = getRuntimeConfig();
	logger.info(`Validating all existing torrent save paths...`);

	const entry = searchees.find((s) => !infoHashPathMap.has(s.infoHash));
	if (entry) {
		logger.warn(
			`Not all torrents from torrentDir are in the torrent client (missing ${entry.name} [${entry.infoHash}]): https://www.cross-seed.org/docs/basics/options#torrentdir`,
		);
	}
	if (infoHashPathMap.size !== searchees.length) {
		logger.warn(
			"Could not ensure all torrents from the torrent client are in torrentDir (likely incorrect torrentDir or torrents with infohash_v2): https://www.cross-seed.org/docs/basics/options#torrentdir",
		);
	}
	if (!linkDir) return;

	for (const searchee of searchees) {
		if (findBlockedStringInReleaseMaybe(searchee, blockList)) {
			infoHashPathMap.delete(searchee.infoHash);
		}
	}
	for (const savePath of new Set(infoHashPathMap.values())) {
		if (ABS_WIN_PATH_REGEX.test(savePath) === (path.sep === "/")) {
			throw new CrossSeedError(
				`Cannot use linkDir with cross platform cross-seed and torrent client: ${savePath}`,
			);
		}
		try {
			testLinking(savePath);
		} catch (e) {
			logger.error(e); // We need to check that this torrent wasn't blocklisted so only log for now
			logger.error(
				"Failed to link from torrent client save paths to linkDir.",
			);
		}
	}
}

export async function waitForTorrentToComplete(
	infoHash: string,
	options = { retries: 6 },
): Promise<boolean> {
	for (let i = 0; i <= options.retries; i++) {
		if ((await getClient()!.isTorrentComplete(infoHash)).orElse(false)) {
			return true;
		}
		if (i < options.retries) {
			await wait(ms("1 second") * 2 ** i);
		}
	}
	return false;
}

export function shouldRecheck(
	searchee: Searchee,
	decision: DecisionAnyMatch,
): boolean {
	const { matchMode } = getRuntimeConfig();
	if (matchMode === MatchMode.SAFE) return true;
	if (decision === Decision.MATCH_PARTIAL) return true;
	if (!searchee.infoHash) return true;
	if (hasExt(searchee.files, VIDEO_DISC_EXTENSIONS)) return true;
	return false; // Skip for MATCH | MATCH_SIZE_ONLY
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
