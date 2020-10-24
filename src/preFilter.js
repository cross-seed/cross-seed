const path = require("path");
const { getRuntimeConfig } = require("./runtimeConfig");
const { EP_REGEX, EXTENSIONS } = require("./constants");
const logger = require("./logger");
const { partial } = require("./utils");

function filterTorrentFile(info) {
	const { includeEpisodes } = getRuntimeConfig();
	const { files, name } = info;
	const logReason = partial(
		logger.verbose,
		"[prefilter]",
		`Torrent ${name} was not selected for searching because`
	);
	if (
		!includeEpisodes &&
		files.length === 1 &&
		EP_REGEX.test(info.files[0].name)
	) {
		logReason("it is a single episode");
		return false;
	}

	const allVideos = files.every((file) =>
		EXTENSIONS.map((e) => `.${e}`).includes(path.extname(file.path))
	);
	if (!allVideos) {
		logReason("not all files are videos");
		return false;
	}

	const cb = (file) => file.path.split(path.sep).length <= 2;
	const notNested = files.every(cb);
	if (!notNested) {
		logReason("the directory tree is more than 2 levels deep");
		return false;
	}

	return true;
}

function filterDupes(metafiles) {
	const filtered = metafiles.filter((meta, index) => {
		const firstOccurrence = metafiles.findIndex(
			(e) => e.name === meta.name
		);
		return index === firstOccurrence;
	});
	const numDupes = metafiles.length - filtered.length;
	if (numDupes > 0) {
		logger.verbose(
			"[prefilter]",
			`${numDupes} duplicates not selected for searching`
		);
	}
	return filtered;
}

module.exports = { filterTorrentFile, filterDupes };
