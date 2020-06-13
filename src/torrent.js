const util = require("util");
const fs = require("fs");
const path = require("path");

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	return parseTorrent(data);
}

function parseTorrentFromURL(result) {
	const remote = util.promisify(require("parse-torrent").remote);
	return remote(result.Link).catch((_) => {
		console.error(chalk.red`error parsing torrent at ${result.Link}`);
		return null;
	});
}

function saveTorrentFile(tracker, tag = "", info, config) {
	const { outputDir } = config;
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
