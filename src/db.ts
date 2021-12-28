import { unlinkSync } from "fs";
import { JSONFileSync, LowSync } from "lowdb";
import path from "path";
import rimraf from "rimraf";
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

const db = new LowSync<Schema>(
	new JSONFileSync<Schema>(path.join(appDir(), "cache.json"))
);

const emptyDatabase = {
	searchees: {},
	decisions: {},
	indexedTorrents: [],
	dbVersion: 3,
};

db.data ??= emptyDatabase;

const dbVersion = db.data.dbVersion;

if (!dbVersion || dbVersion < emptyDatabase.dbVersion) {
	db.data = emptyDatabase;
}

db.write();

export function dropDatabase(): void {
	db.data = emptyDatabase;
	db.write();
	unlinkSync(path.join(appDir(), "cache.json"));
	rimraf.sync(path.join(appDir(), "torrent_cache"));
}

export default db;
