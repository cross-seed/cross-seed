const util = require("util");
const fs = require("fs");
const path = require("path");
const parseTorrent = require("parse-torrent");
const remote = util.promisify(parseTorrent.remote);
const chalk = require("chalk");

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	return parseTorrent(data);
}

function parseTorrentFromURL(url) {
	return remote(url).catch((_) => {
		console.error(chalk.red`error parsing torrent at ${url}`);
		return null;
	});
}

function saveTorrentFile(tracker, tag = "", info, outputDir) {
	const buf = parseTorrent.toTorrentFile(info);
	const name = info.name.replace(/.mkv$/, "");
	const filename = `[${tag}][${tracker}]${name}.torrent`;
	fs.writeFileSync(path.join(outputDir, filename), buf, { mode: 0o644 });
}

function loadTorrentDir(torrentDir) {
	const dirContents = fs
		.readdirSync(torrentDir)
		.filter((fn) => path.extname(fn) === ".torrent")
		.map((fn) => path.join(torrentDir, fn));
	return dirContents.map(parseTorrentFromFilename);
}

module.exports = {
	parseTorrentFromFilename,
	parseTorrentFromURL,
	saveTorrentFile,
	loadTorrentDir,
};
