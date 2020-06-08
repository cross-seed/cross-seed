#!/usr/bin/env node

const parseTorrent = require("parse-torrent");
const fs = require("fs");
const path = require("path");

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	const torrentInfo = parseTorrent(data);
	return torrentInfo;
}

function filterTorrentFile(info) {
	if (info.files.length < 4) {
		console.log(`not enough files: ${info.name}`);
		return false;
	}
	const allMkvs = info.files.every(file => file.path.endsWith(".mkv"));
	if (!allMkvs) {
		console.log(`not all mkvs: ${info.name}`);
		return false;
	}
	return true;
}

function main() {
	const dirContents = fs.readdirSync("torrents")
		.map(fn => path.join("torrents", fn));
	const parsedTorrents = dirContents.map(parseTorrentFromFilename);
	const filteredTorrents = parsedTorrents.filter(filterTorrentFile);
	console.log(filteredTorrents.map(x => x.name));
}

main();
