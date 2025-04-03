import path from "path";
import ms from "ms";
import { testLinking } from "../action.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile, sanitizeTrackerUrl } from "../parseTorrent.js";
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
import { Searchee, SearcheeClient, SearcheeWithInfoHash } from "../searchee.js";
import { formatAsList, isTruthy, wait } from "../utils.js";
import Deluge from "./Deluge.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";
import { hasExt } from "../utils.js";

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
	label: string;
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

const PARSE_CLIENT_REGEX = /^(?<clientType>.+?):(?<url>.*)$/;
export function parseClientEntry(
	clientEntry: string,
): { clientType: TorrentClientType; url: string } | null {
	const match = clientEntry.match(PARSE_CLIENT_REGEX);
	if (!match?.groups) return null;
	return {
		clientType: match.groups.clientType as TorrentClientType,
		url: match.groups.url,
	};
}

export function instantiateDownloadClients() {
	const { torrentClients } = getRuntimeConfig();
	for (const [priority, clientEntryRaw] of torrentClients.entries()) {
		const clientEntry = parseClientEntry(clientEntryRaw)!;
		switch (clientEntry.clientType) {
			case Label.QBITTORRENT:
				activeClients.push(new QBittorrent(clientEntry.url, priority));
				break;
			case Label.RTORRENT:
				activeClients.push(new RTorrent(clientEntry.url, priority));
				break;
			case Label.TRANSMISSION:
				activeClients.push(new Transmission(clientEntry.url, priority));
				break;
			case Label.DELUGE:
				activeClients.push(new Deluge(clientEntry.url, priority));
				break;
			default:
				throw new Error(
					`Invalid client type: ${clientEntry.clientType}`,
				);
		}
	}
}

export function getClients(): TorrentClient[] {
	return activeClients;
}

export function getClient(searchee: Searchee): TorrentClient | undefined {
	const clients = getClients();
	if (clients.length === 1) return clients[0];
	return clients.find((c) => c.clientHost === searchee.clientHost);
}

/**
 * Use byClientPriority if Searchee is available for a complete check
 */
export function byClientHostPriority(clientHost: string | undefined): number {
	const clients = getClients();
	return (
		clients.find((c) => c.clientHost === clientHost)?.clientPriority ??
		clients.length
	);
}

export function byClientPriority(searchee: Searchee): number {
	return byClientHostPriority(getClient(searchee)?.clientHost);
}

export async function validateClientSavePaths(
	searchees: SearcheeWithInfoHash[],
	infoHashPathMapOrig: Map<string, string>,
	label: string,
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
	logger.verbose({
		label,
		message: `Excluded save paths from linking test due to filters: ${formatAsList(ignoredSavePaths, { sort: true, type: "unit" })}`,
	});

	for (const savePath of uniqueSavePaths) {
		if (ABS_WIN_PATH_REGEX.test(savePath) === (path.sep === "/")) {
			throw new CrossSeedError(
				`Cannot use linkDirs with cross platform cross-seed and ${label}, please run cross-seed in docker or natively to match your torrent client (https://www.cross-seed.org/docs/basics/managing-the-daemon): ${savePath}`,
			);
		}
		try {
			testLinking(savePath);
		} catch (e) {
			logger.error(e);
			throw new CrossSeedError(
				`Failed to link from ${label} save paths to a linkDir. If you have multiple drives, you will need to add extra linkDirs or blocklist the category, tag, or trackers that correspond to the drives (https://www.cross-seed.org/docs/tutorials/linking#setting-up-linking)`,
			);
		}
	}
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
