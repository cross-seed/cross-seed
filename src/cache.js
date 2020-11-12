const path = require("path");
const fs = require("fs");
const { createAppDir, appDir } = require("./configuration");
const CACHE_PREFIX_TIMESTAMPS = "searchTimestamps";

let cache = {};
let fileExists = false;

function loadFromDisk() {
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		cache = require(fpath);
		if (Array.isArray(cache)) {
			cache = migrateV1Cache(cache);
			write();
		}
	}
}

function migrateV1Cache(fileCache) {
	const newCache = {};
	fileCache.forEach((cacheEntry) => {
		newCache[cacheEntry] = true;
	});
	return newCache;
}

function write() {
	const fpath = path.join(appDir(), "cache.json");
	if (!fileExists) createAppDir();
	fs.writeFileSync(fpath, JSON.stringify(cache));
}

function save(key, val = true) {
	cache[key] = val;
	write();
}

function get(key) {
	try {
		return cache[key];
	} catch (e) {
		return null;
	}
}

function includes(thing) {
	return Object.keys(cache).includes(thing);
}

function clear() {
	cache = {};
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		write();
	}
}

loadFromDisk();

module.exports = { save, includes, clear, get, CACHE_PREFIX_TIMESTAMPS };
