const path = require("path");
const { EP_REGEX } = require("./constants");

function filterTorrentFile(info, index, arr) {
	const { files } = info;
	if (files.length === 1 && EP_REGEX.test(info.files[0].name)) {
		return false;
	}

	const allMkvs = files.every((file) => path.extname(file.path) === ".mkv");
	if (!allMkvs) return false;

	const cb = (file) => file.path.split(path.sep).length <= 2;
	const notNested = files.every(cb);
	if (!notNested) return false;

	const firstOccurrence = arr.findIndex((e) => e.name === info.name);
	if (index !== firstOccurrence) return false;

	return true;
}

module.exports = { filterTorrentFile };
