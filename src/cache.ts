import { readFile, rename } from "fs/promises";
import path from "path";
import { appDir, createAppDir } from "./configuration.js";
import { Decision } from "./constants.js";

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
		path.join(appDir(), "old-cache.json.bak")
	);
}
