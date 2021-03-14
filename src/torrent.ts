const fs = require("fs");
const path = require("path");
const parseTorrent = require("parse-torrent");
const { getRuntimeConfig } = require("./runtimeConfig");
const { stripExtension } = require("./utils");
const logger = require("./logger");
const get = require("simple-get");

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	return parseTorrent(data);
}

async function parseTorrentFromURL(url) {
	let response;
	try {
		response = await new Promise((resolve, reject) => {
			get.concat({ url, followRedirects: false }, (err, res, data) => {
				if (err) return reject(err);
				res.data = data;
				return resolve(res);
			});
		});
	} catch (e) {
		logger.error(`error: failed to access ${url}`);
		logger.debug("reason", e);
		return null;
	}

	if (response.statusCode < 200 || response.statusCode >= 300) {
		if (
			response.statusCode >= 300 &&
			response.statusCode < 400 &&
			response.headers.location &&
			response.headers.location.startsWith("magnet:")
		) {
			logger.error(`Unsupported: magnet link detected at ${url}`);
			return null;
		} else {
			logger.error(
				`error downloading torrent at ${url}: ${response.statusCode} ${response.statusMessage}`
			);
			logger.debug("response:", response.data);
			logger.debug("headers:", response.headers);
			return null;
		}
	}

	try {
		return parseTorrent(response.data);
	} catch (e) {
		logger.error(`error: invalid torrent contents at ${url}`);
		logger.debug("reason:", e);
		return null;
	}
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
