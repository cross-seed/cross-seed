const path = require("path");
const fs = require("fs");
const { createAppDir, appDir } = require("./configuration");
const CACHE_NAMESPACE_TORRENTS = "torrents";
const CACHE_NAMESPACE_REJECTIONS = "rejections";

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

function save(namespace, key, val = true) {
	cache[namespace][key] = val;
	write();
}

function get(namespace, key) {
	return cache[namespace][key];
}

function clear() {
	cache = emptyCache;
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		write();
	}
}

loadFromDisk();

module.exports = {
	save,
	clear,
	get,
	CACHE_NAMESPACE_TORRENTS,
	CACHE_NAMESPACE_REJECTIONS,
};
