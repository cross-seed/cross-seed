import path from "path";
import ms from "ms";
import { testLinking } from "../action.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { filterByContent } from "../preFilter.js";
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
import { formatAsList, wait } from "../utils.js";
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
	trackers?: string[];
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
		v1HashOnly?: boolean;
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

export async function validateClientSavePaths(
	searchees: SearcheeWithInfoHash[],
	infoHashPathMap: Map<string, string>,
): Promise<void> {
	const { linkDirs } = getRuntimeConfig();
	logger.info(`Validating all existing torrent save paths...`);

	const entryDir = searchees.find((s) => !infoHashPathMap.has(s.infoHash));
	if (entryDir) {
		logger.warn(
			`Not all torrents from torrentDir are in the torrent client (missing ${entryDir.name} [${entryDir.infoHash}]): https://www.cross-seed.org/docs/basics/options#torrentdir`,
		);
	}
	const searcheeInfoHashes = new Set(searchees.map((s) => s.infoHash));
	const entryClient = Array.from(infoHashPathMap.keys()).find(
		(infoHash) => !searcheeInfoHashes.has(infoHash),
	);
	if (entryClient) {
		logger.warn(
			`Could not ensure all torrents from the torrent client are in torrentDir (missing ${entryClient} with savePath ${infoHashPathMap.get(entryClient)}): https://www.cross-seed.org/docs/basics/options#torrentdir`,
		);
	}
	if (!linkDirs.length) return;

	const removedSavePaths = new Set<string>();
	for (const searchee of searchees) {
		if (!filterByContent({ ...searchee, label: Label.SEARCH })) {
			if (infoHashPathMap.has(searchee.infoHash)) {
				removedSavePaths.add(infoHashPathMap.get(searchee.infoHash)!);
				infoHashPathMap.delete(searchee.infoHash);
			}
		}
	}
	const uniqueSavePaths = new Set(infoHashPathMap.values());
	const ignoredSavePaths = Array.from(removedSavePaths).filter(
		(savePath) => !uniqueSavePaths.has(savePath),
	);
	logger.verbose(
		`Excluded save paths from linking test due to filters: ${formatAsList(ignoredSavePaths, { sort: true, type: "unit" })}`,
	);

	for (const savePath of uniqueSavePaths) {
		if (ABS_WIN_PATH_REGEX.test(savePath) === (path.sep === "/")) {
			throw new CrossSeedError(
				`Cannot use linkDir with cross platform cross-seed and torrent client, please run cross-seed in docker or natively to match your torrent client (https://www.cross-seed.org/docs/basics/managing-the-daemon): ${savePath}`,
			);
		}
		try {
			testLinking(savePath);
		} catch (e) {
			logger.error(e);
			throw new CrossSeedError(
				"Failed to link from torrent client save paths to a linkDir. If you have a temp/cache drive, you will need to add extra linkDirs or blocklist the category, tag, or trackers that correspond to it.",
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
	const { skipRecheck } = getRuntimeConfig();
	if (!skipRecheck) return true;
	if (decision === Decision.MATCH_PARTIAL) return true;
	if (hasExt(searchee.files, VIDEO_DISC_EXTENSIONS)) return true;
	return false; // Skip for MATCH | MATCH_SIZE_ONLY
}

// Resuming partials
export function getMaxRemainingBytes(decision: DecisionAnyMatch) {
	const { matchMode, autoResumeMaxDownload } = getRuntimeConfig();
	if (decision !== Decision.MATCH_PARTIAL) return 0;
	if (matchMode !== MatchMode.PARTIAL) return 0;
	return autoResumeMaxDownload;
}
export const resumeSleepTime = ms("15 seconds");
export const resumeErrSleepTime = ms("5 minutes");
export function getResumeStopTime() {
	return Date.now() + ms("1 hour");
}
