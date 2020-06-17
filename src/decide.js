const { parseTorrentFromURL } = require("./torrent");
const cache = require("./cache");
const { EP_REGEX, MOVIE_REGEX, SEASON_REGEX } = require("./constants");

function compareFileTrees(a, b) {
	if (a.length !== b.length) return false;
	const sorter = (m, n) => (m.path < n.path ? -1 : m.path > n.path ? 1 : 0);
	const sortedA = a.slice().sort(sorter);
	const sortedB = b.slice().sort(sorter);

	const cmp = (elOfA, elOfB) => {
		const pathsAreEqual = elOfB.path === elOfA.path;
		const lengthsAreEqual = elOfB.length === elOfA.length;
		return pathsAreEqual && lengthsAreEqual;
	};
	return sortedA.every((elOfA, i) => cmp(elOfA, sortedB[i]));
}

function assessResultPreDownload(result, ogInfo) {
	const { length } = ogInfo;
	const lowerBound = length - 0.01 * length;
	const upperBound = length + 0.01 * length;
	return result.Size >= lowerBound && result.Size <= upperBound;
}

function getTag(name) {
	return EP_REGEX.test(name)
		? "episode"
		: SEASON_REGEX.test(name)
		? "pack"
		: MOVIE_REGEX.test(name)
		? "movie"
		: "unknown";
}

async function assessResultHelper(result, ogInfo, hashesToExclude) {
	const { TrackerId: tracker, Link } = result;

	if (!assessResultPreDownload(result, ogInfo)) return null;

	const info = await parseTorrentFromURL(Link);

	// if you got rate limited or some other failure
	if (!info) return info;

	if (info.length !== ogInfo.length) return null;
	if (hashesToExclude.includes(info.infoHash)) return null;
	if (!compareFileTrees(info.files, ogInfo.files)) return null;

	const tag = getTag(info.name);
	return { tracker, tag, info };
}

function assessResultCaching(result, ogInfo, hashesToExclude) {
	const cacheKey = `${ogInfo.name}|${result.Guid}`;
	if (cache.includes(cacheKey)) return null;
	const assessPromise = assessResultHelper(result, ogInfo, hashesToExclude);
	assessPromise.then((assessed) => !assessed && cache.save(cacheKey));
	return assessPromise;
}

module.exports = { assessResult: assessResultCaching };
