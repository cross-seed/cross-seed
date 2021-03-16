import fs from "fs";
import path from "path";
import { appDir, createAppDir } from "./configuration";

export interface TorrentEntry {
	firstSearched: number;
	lastSearched: number;
}

export const CACHE_NAMESPACE_TORRENTS = "torrents";
export const CACHE_NAMESPACE_REJECTIONS = "rejections";

const emptyCache = {
	[CACHE_NAMESPACE_TORRENTS]: {},
	[CACHE_NAMESPACE_REJECTIONS]: {},
};
let cache = emptyCache;
let fileExists = false;

function loadFromDisk() {
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		cache = require(fpath);
		if (Array.isArray(cache)) {
			cache = migrateV1Cache(cache);
		}
	}
}

function migrateV1Cache(fileCache) {
	const newCache = emptyCache;
	fileCache.forEach((cacheEntry) => {
		newCache[CACHE_NAMESPACE_REJECTIONS][cacheEntry] = true;
	});
	return newCache;
}

function write() {
	const fpath = path.join(appDir(), "cache.json");
	if (!fileExists) createAppDir();
	fs.writeFileSync(fpath, JSON.stringify(cache));
}

export function save(
	namespace: string,
	key: string,
	val: unknown = true
): void {
	cache[namespace][key] = val;
	write();
}

export function get(namespace: string, key: string): unknown {
	return cache[namespace][key];
}

export function clear(): void {
	cache = emptyCache;
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		write();
	}
}

loadFromDisk();
