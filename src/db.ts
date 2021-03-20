import lowdb from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import path from "path";
import { appDir, createAppDir } from "./configuration";
import { Decision, DECISIONS, TORRENTS } from "./constants";
import { unlinkSync } from "fs";

createAppDir();

export interface TorrentEntry {
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

interface Schema {
	[TORRENTS]: { [infoHash: string]: TorrentEntry };
	[DECISIONS]: Record<string, Record<string, DecisionEntry>>;
	dbVersion: number;
}

const db = lowdb(new FileSync<Schema>(path.join(appDir(), "cache.json")));

const emptyDatabase = {
	[TORRENTS]: {},
	[DECISIONS]: {},
	dbVersion: 0,
};

db.defaults(emptyDatabase).write();

export function dropDatabase(): void {
	db.setState(emptyDatabase).write();
	unlinkSync(path.join(appDir(), "cache.json"));
}

export default db;
