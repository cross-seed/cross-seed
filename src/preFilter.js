const path = require("path");
const { EP_REGEX, EXTENSIONS } = require("./constants");

const filterTorrentFile = (includeEpisodes) => (info) => {
	const { files } = info;
	if (
		!includeEpisodes &&
		files.length === 1 &&
		EP_REGEX.test(info.files[0].name)
	) {
		return false;
	}

	const allVideos = files.every((file) =>
		EXTENSIONS.map((e) => `.${e}`).includes(path.extname(file.path))
	);
	if (!allVideos) return false;

	const cb = (file) => file.path.split(path.sep).length <= 2;
	const notNested = files.every(cb);
	if (!notNested) return false;

	return true;
};

function filterDupes(metaFiles) {
	return metaFiles.filter((info, index) => {
		const firstOccurrence = metaFiles.findIndex(
			(e) => e.name === info.name
		);
		return index === firstOccurrence;
	});
}

module.exports = { filterTorrentFile, filterDupes };
