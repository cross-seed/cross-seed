const util = require("util");
const fs = require("fs");
const path = require("path");
const parseTorrent = require("parse-torrent");
const remote = util.promisify(parseTorrent.remote);
const chalk = require("chalk");
const { getRuntimeConfig } = require("./configuration");
const { stripExtension } = require("./utils");
const logger = require("./logger");

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	return parseTorrent(data);
}

function parseTorrentFromURL(url) {
	return remote(url).catch((_) => {
		logger.error(chalk.red`error parsing torrent at ${url}`);
		return null;
	});
}

function saveTorrentFile(tracker, tag = "", info) {
	const { outputDir } = getRuntimeConfig();
	const buf = parseTorrent.toTorrentFile(info);
	const name = stripExtension(info.name);
	const filename = `[${tag}][${tracker}]${name}.torrent`;
	fs.writeFileSync(path.join(outputDir, filename), buf, { mode: 0o644 });
}

function findAllTorrentFilesInDir(torrentDir) {
	return fs
		.readdirSync(torrentDir)
		.filter((fn) => path.extname(fn) === ".torrent")
		.map((fn) => path.join(torrentDir, fn));
}

// this is rtorrent specific
function getInfoHashesToExclude() {
	const { torrentDir } = getRuntimeConfig();
	return findAllTorrentFilesInDir(torrentDir).map((pathname) =>
		path.basename(pathname, ".torrent").toLowerCase()
	);
}

function loadTorrentDir() {
	const { torrentDir } = getRuntimeConfig();
	const dirContents = findAllTorrentFilesInDir(torrentDir);
	return dirContents.map(parseTorrentFromFilename);
}

function getTorrentByName(name) {
	const { torrentDir } = getRuntimeConfig();
	const dirContents = findAllTorrentFilesInDir(torrentDir);
	const findResult = dirContents.find((filename) => {
		const meta = parseTorrentFromFilename(filename);
		return meta.name === name;
	});
	if (findResult === undefined) {
		const message = `could not find a torrent with the name ${name}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult);
}

module.exports = {
	parseTorrentFromFilename,
	parseTorrentFromURL,
	saveTorrentFile,
	loadTorrentDir,
	getTorrentByName,
	getInfoHashesToExclude,
};
