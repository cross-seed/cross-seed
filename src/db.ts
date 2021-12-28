import { sync as rimrafSync } from "rimraf";
import lowdb from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import path from "path";
import { appDir, createAppDir } from "./configuration.js";
import {
	Decision,
	DECISIONS,
	INDEXED_TORRENTS,
	SEARCHEES,
} from "./constants.js";
import { unlinkSync } from "fs";

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
	[SEARCHEES]: Record<string, SearcheeEntry>;
	[DECISIONS]: Record<string, Record<string, DecisionEntry>>;
	[INDEXED_TORRENTS]: TorrentEntry[];
	dbVersion: number;
}

const db = lowdb(new FileSync<Schema>(path.join(appDir(), "cache.json")));

const emptyDatabase = {
	[SEARCHEES]: {},
	[DECISIONS]: {},
	[INDEXED_TORRENTS]: [],
	dbVersion: 3,
};

const dbVersion = db.get("dbVersion").value();

if (!dbVersion || dbVersion < emptyDatabase.dbVersion) {
	db.setState(emptyDatabase);
}

db.defaults(emptyDatabase).write();

export function dropDatabase(): void {
	db.setState(emptyDatabase).write();
	unlinkSync(path.join(appDir(), "cache.json"));
	rimrafSync(path.join(appDir(), "torrent_cache"));
}

export default db;
