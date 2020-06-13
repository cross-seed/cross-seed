const path = require("path");
const fs = require("fs");
const { createAppDir, appDir } = require("./configuration");

let cache = [];
let fileExists = false;

function loadFromDisk() {
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		cache = JSON.parse(fs.readFileSync(fpath));
	}
}

function write() {
	const fpath = path.join(appDir(), "cache.json");
	if (!fileExists) createAppDir();
	console.log(cache);
	fs.writeFileSync(fpath, JSON.stringify(cache));
}

function save(thing) {
	console.log(cache);
	cache.push(thing);
	write();
}

function includes(thing) {
	return cache.includes(thing);
}

function clear() {
	cache = [];
	const fpath = path.join(appDir(), "cache.json");
	if (fs.existsSync(fpath)) {
		fileExists = true;
		write();
	}
}

loadFromDisk();

module.exports = { save, includes, clear };
