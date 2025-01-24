import bencode from "bencode";
import { readFile, rename } from "fs/promises";
import path from "path";
import { appDir, createAppDir } from "./configuration.js";
import { Decision, TORRENT_CACHE_FOLDER } from "./constants.js";
import { findAllTorrentFilesInDir } from "./torrent.js";
import { writeFileSync } from "fs";
import { Torrent } from "./parseTorrent.js";

createAppDir();

export interface SearcheeEntry {
	infoHash?: string;
	firstSearched: number;
	lastSearched: number;
}

export interface DecisionEntry {
	decision: Decision;
	firstSeen: number;
	lastSeen: number;
	infoHash?: string;
}

export interface TorrentEntry {
	filepath: string;
	infoHash: string;
	name: string;
}

export interface Schema {
	searchees: Record<string, SearcheeEntry>;
	decisions: Record<string, Record<string, DecisionEntry>>;
	indexedTorrents: TorrentEntry[];
	dbVersion: number;
}

export async function getCacheFileData(): Promise<Schema> {
	return readFile(path.join(appDir(), "cache.json"))
		.then((data) => JSON.parse(data.toString()))
		.catch(() => undefined);
}

export async function renameCacheFile(): Promise<void> {
	return rename(
		path.join(appDir(), "cache.json"),
		path.join(appDir(), "old-cache.bak.json"),
	);
}

export async function updateTorrentCache(
	oldUrl: string,
	newUrl: string,
): Promise<void> {
	const torrentFilePaths = await findAllTorrentFilesInDir(
		path.join(appDir(), TORRENT_CACHE_FOLDER),
	);
	console.log(
		`Found ${torrentFilePaths.length} torrent files in cache, processing...`,
	);
	let count = 0;
	for (const filePath of torrentFilePaths) {
		try {
			const torrent: Torrent = bencode.decode(await readFile(filePath));
			const announce = torrent.announce?.toString();
			const announceList = torrent["announce-list"]?.map((tier) =>
				tier.map((url) => url.toString()),
			);
			if (
				announce?.includes(oldUrl) ||
				announceList?.some((t) => t.some((url) => url.includes(oldUrl)))
			) {
				count++;
				console.log(`#${count}: ${filePath}`);
				let updated = false;
				if (announce) {
					const newAnnounce = announce.replace(oldUrl, newUrl);
					if (announce !== newAnnounce) {
						updated = true;
						console.log(`--- ${announce} -> ${newAnnounce}`);
						torrent.announce = Buffer.from(newAnnounce);
					}
				}
				if (announceList) {
					torrent["announce-list"] = announceList.map((tier) =>
						tier.map((url) => {
							const newAnnounce = url.replace(oldUrl, newUrl);
							if (url === newAnnounce) return Buffer.from(url);
							updated = true;
							console.log(`--- ${url} -> ${newAnnounce}`);
							return Buffer.from(newAnnounce);
						}),
					);
				}
				if (updated) writeFileSync(filePath, bencode.encode(torrent));
			}
		} catch (e) {
			console.error(`Error reading ${filePath}: ${e}`);
		}
	}
}
