#!/usr/bin/env node

const parseTorrent = require("parse-torrent");
const fs = require("fs");
const path = require("path");
const axios = require("axios").default;
const querystring = require("querystring");

const jackettServerUrl = "***REMOVED***";
const jackettPath = "/api/v2.0/indexers/all/results";
const jackettApiKey = "***REMOVED***";

function makeJackettRequest(query) {
	const params = querystring.stringify({
		apikey: jackettApiKey,
		Query: query
	});
	return axios.get(`${jackettServerUrl}${jackettPath}`, params);
}

function parseTorrentFromFilename(filename) {
	const data = fs.readFileSync(filename);
	const torrentInfo = parseTorrent(data);
	return torrentInfo;
}

function filterTorrentFile(info) {
	const allMkvs = info.files.every(file => file.path.endsWith(".mkv"));
	if (!allMkvs) return false;

	const cb = file => file.path.split(path.sep).length <= 2;
	const notNested = info.files.every(cb);
	if (!notNested) return false;

	return true;
}

function main() {
	const dirContents = fs.readdirSync("torrents")
		.map(fn => path.join("torrents", fn));
	const parsedTorrents = dirContents.map(parseTorrentFromFilename);
	const filteredTorrents = parsedTorrents.filter(filterTorrentFile);

	const samples = filteredTorrents.slice(0, 4);
	console.log(samples.map(t => t.name));

}

main();
