import ms from "ms";
import path from "path";
import { isDeepStrictEqual } from "util";
import { testLinking } from "../action.js";
import {
	ABS_WIN_PATH_REGEX,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	MatchMode,
	RESUME_EXCLUDED_EXTS,
	RESUME_EXCLUDED_KEYWORDS,
	VIDEO_DISC_EXTENSIONS,
} from "../constants.js";
import { getPartialSizeRatio } from "../decide.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile, sanitizeTrackerUrl } from "../parseTorrent.js";
import { filterByContent } from "../preFilter.js";
import { Result } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeClient, SearcheeWithInfoHash } from "../searchee.js";
import {
	formatAsList,
	hasExt,
	humanReadableSize,
	isTruthy,
	wait,
} from "../utils.js";
import Deluge from "./Deluge.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";

const activeClients: TorrentClient[] = [];

type TorrentClientType =
	| Label.QBITTORRENT
	| Label.RTORRENT
	| Label.TRANSMISSION
	| Label.DELUGE;

export type Tracker = { url: string; tier: number };

export interface TorrentMetadataInClient {
	infoHash: string;
	category?: string;
	tags?: string[];
	trackers?: string[];
}

export interface ClientSearcheeResult {
	searchees: SearcheeClient[];
	newSearchees: SearcheeClient[];
}

export interface TorrentClient {
	clientHost: string;
	clientPriority: number;
	clientType: TorrentClientType;
	readonly: boolean;
	label: string;
	isTorrentInClient: (infoHash: string) => Promise<Result<boolean, Error>>;
	isTorrentComplete: (
		infoHash: string,
	) => Promise<Result<boolean, "NOT_FOUND">>;
	isTorrentChecking: (
		infoHash: string,
	) => Promise<Result<boolean, "NOT_FOUND">>;
	getAllTorrents: () => Promise<TorrentMetadataInClient[]>;
	/**
	 * Get all searchees from the client and update the db
	 * @param options.newSearcheesOnly only return searchees that are not in the db
	 * @param options.refresh undefined uses the cache, [] refreshes all searchees, or a list of infoHashes to refresh
	 * @return an object containing all searchees and new searchees (refreshed searchees are considered new)
	 */
	getClientSearchees: (options?: {
		newSearcheesOnly?: boolean;
		refresh?: string[];
	}) => Promise<ClientSearcheeResult>;
	getDownloadDir: (
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	) => Promise<
		Result<
			string,
			| "NOT_FOUND"
			| "TORRENT_NOT_COMPLETE"
			| "INVALID_DATA"
			| "UNKNOWN_ERROR"
		>
	>;
	getAllDownloadDirs: (options: {
		metas: SearcheeWithInfoHash[] | Metafile[];
		onlyCompleted: boolean;
		v1HashOnly?: boolean;
	}) => Promise<Map<string, string>>;
	resumeInjection: (
		meta: Metafile,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	) => Promise<void>;
	inject: (
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		options: { onlyCompleted: boolean; destinationDir?: string },
	) => Promise<InjectionResult>;
	recheckTorrent: (infoHash: string) => Promise<void>;
	validateConfig: () => Promise<void>;
}

const PARSE_CLIENT_REGEX =
	/^(?<clientType>.+?):(?:(?<readonly>readonly):)?(?<url>.*)$/;
export function parseClientEntry(
	clientEntry: string,
): { clientType: TorrentClientType; readonly: boolean; url: string } | null {
	const match = clientEntry.match(PARSE_CLIENT_REGEX);
	if (!match?.groups) return null;
	return {
		clientType: match.groups.clientType as TorrentClientType,
		readonly: isTruthy(match.groups.readonly),
		url: match.groups.url,
	};
}

export function instantiateDownloadClients() {
	const { torrentClients } = getRuntimeConfig();
	for (const [priority, clientEntryRaw] of torrentClients.entries()) {
		const { clientType, readonly, url } = parseClientEntry(clientEntryRaw)!;
		switch (clientType) {
			case Label.QBITTORRENT:
				activeClients.push(new QBittorrent(url, priority, readonly));
				break;
			case Label.RTORRENT:
				activeClients.push(new RTorrent(url, priority, readonly));
				break;
			case Label.TRANSMISSION:
				activeClients.push(new Transmission(url, priority, readonly));
				break;
			case Label.DELUGE:
				activeClients.push(new Deluge(url, priority, readonly));
				break;
			default:
				throw new Error(`Invalid client type: ${clientType}`);
		}
	}
}

export function getClients(): TorrentClient[] {
	return activeClients;
}

export function byClientHostPriority(clientHost: string | undefined): number {
	const clients = getClients();
	return (
		clients.find((c) => c.clientHost === clientHost)?.clientPriority ??
		clients.length
	);
}

export async function validateClientSavePaths(
	searchees: SearcheeWithInfoHash[],
	infoHashPathMapOrig: Map<string, string>,
	label: string,
	clientPriority: number,
): Promise<void> {
	const { linkDirs } = getRuntimeConfig();
	logger.info({
		label,
		message: `Validating all existing torrent save paths...`,
	});
	const infoHashPathMap = new Map(infoHashPathMapOrig);

	const entryDir = searchees.find((s) => !infoHashPathMap.has(s.infoHash));
	if (entryDir) {
		logger.warn({
			label,
			message: `Not all torrents from torrentDir are in the torrent client (missing ${entryDir.name} [${entryDir.infoHash}]): https://www.cross-seed.org/docs/basics/options#torrentdir`,
		});
	}
	const searcheeInfoHashes = new Set(searchees.map((s) => s.infoHash));
	const entryClient = Array.from(infoHashPathMap.keys()).find(
		(infoHash) => !searcheeInfoHashes.has(infoHash),
	);
	if (entryClient) {
		logger.warn({
			label,
			message: `Could not ensure all torrents from the torrent client are in torrentDir (missing ${entryClient} with savePath ${infoHashPathMap.get(entryClient)}): https://www.cross-seed.org/docs/basics/options#torrentdir`,
		});
	}
	if (!linkDirs.length) return;

	const removedSavePaths = new Set<string>();
	for (const searchee of searchees) {
		if (!(await filterByContent({ ...searchee, label: Label.SEARCH }))) {
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
	logger.verbose({
		label,
		message: `Excluded save paths from linking test due to filters: ${formatAsList(
			ignoredSavePaths,
			{
				sort: true,
				type: "unit",
			},
		)}`,
	});

	for (const savePath of uniqueSavePaths) {
		if (ABS_WIN_PATH_REGEX.test(savePath) === (path.sep === "/")) {
			throw new CrossSeedError(
				`Cannot use linkDirs with cross platform cross-seed and ${label}, please run cross-seed in docker or natively to match your torrent client (https://www.cross-seed.org/docs/basics/managing-the-daemon): ${savePath}`,
			);
		}
		try {
			await testLinking(
				savePath,
				`torrentClient${clientPriority}Src.cross-seed`,
				`torrentClient${clientPriority}Dest.cross-seed`,
			);
		} catch (e) {
			logger.error(e);
			throw new CrossSeedError(
				`Failed to link from ${label} save paths to a linkDir. If you have multiple drives, you will need to add extra linkDirs or blocklist the category, tag, or trackers that correspond to the drives (https://www.cross-seed.org/docs/tutorials/linking#setting-up-linking)`,
			);
		}
	}
}

export function clientSearcheeModified(
	label: string,
	dbTorrent,
	name: string,
	savePath: string,
	options: { category?: string; tags?: string[] } = {},
): boolean {
	if (!dbTorrent) return true;
	if (dbTorrent.name !== name) return true;
	if (dbTorrent.save_path !== savePath) return true;
	if ((dbTorrent.category ?? undefined) !== options.category) return true;
	if (
		!isDeepStrictEqual(
			dbTorrent.tags ? JSON.parse(dbTorrent.tags) : [],
			options.tags ?? [],
		)
	) {
		return true;
	}
	return false;
}

export function organizeTrackers(trackers: Tracker[]): string[] {
	return trackers.map((t) => sanitizeTrackerUrl(t.url)).filter(isTruthy);
}

export async function waitForTorrentToComplete(
	client: TorrentClient,
	infoHash: string,
	options = { retries: 6 },
): Promise<boolean> {
	const retries = Math.max(options.retries, 0);
	for (let i = 0; i <= retries; i++) {
		if ((await client.isTorrentComplete(infoHash)).orElse(false)) {
			return true;
		}
		if (i < retries) {
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

/**
 * Checks if the torrent should be resumed based on excluded files
 *
 * @param meta metafile object containing torrent information
 * @param remainingSize remaining size of the torrent
 * @param options.torrentLog torrent log string
 * @param options.label torrent client label
 * @returns boolean determining if the torrent should be resumed
 */
export function shouldResumeFromNonRelevantFiles(
	meta: Metafile,
	remainingSize: number,
	decision: DecisionAnyMatch,
	options?: { torrentLog: string; label: string },
): boolean {
	const { ignoreNonRelevantFilesToResume, matchMode } = getRuntimeConfig();
	if (!ignoreNonRelevantFilesToResume) return false;
	if (decision !== Decision.MATCH_PARTIAL) return false;
	if (matchMode !== MatchMode.PARTIAL) return false;
	if (remainingSize > 209715200) {
		if (options) {
			logger.warn({
				label: options.label,
				message: `ignoreNonRelevantFilesToResume will not resume ${options.torrentLog}: 200 MiB limit`,
			});
		}
		return false;
	}

	const irrelevantSize = meta.files.reduce((acc, { path, length }) => {
		const shouldExclude =
			RESUME_EXCLUDED_KEYWORDS.some((keyword) =>
				path.toLowerCase().includes(keyword),
			) ||
			RESUME_EXCLUDED_EXTS.some((ext) =>
				path.toLowerCase().endsWith(ext),
			);
		if (!shouldExclude) return acc;
		if (options) {
			logger.verbose({
				label: options.label,
				message: `${options.torrentLog}: excluding file ${path} from auto resume check`,
			});
		}
		return acc + length;
	}, 0);

	if (irrelevantSize === 0) {
		if (options) {
			logger.warn({
				label: options.label,
				message: `ignoreNonRelevantFilesToResume will not resume ${options.torrentLog}: all files are relevant`,
			});
		}
		return false;
	}
	if (remainingSize <= irrelevantSize + meta.pieceLength * 2) return true;
	if (options) {
		logger.warn({
			label: options.label,
			message: `ignoreNonRelevantFilesToResume will not resume ${options.torrentLog}: remainingSize ${humanReadableSize(remainingSize, { binary: true })} > ${humanReadableSize(irrelevantSize, { binary: true })} irrelevantSize`,
		});
	}
	return false;
}

export function estimatePausedStatus(
	meta: Metafile,
	searchee: Searchee,
	decision: DecisionAnyMatch,
): boolean {
	const { autoResumeMaxDownload } = getRuntimeConfig();
	const remaining = (1 - getPartialSizeRatio(meta, searchee)) * meta.length;
	if (remaining <= autoResumeMaxDownload) return false;
	return !shouldResumeFromNonRelevantFiles(meta, remaining, decision);
}
