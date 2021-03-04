const { parseTorrentFromURL } = require("./torrent");
const cache = require("./cache");
const { EP_REGEX, MOVIE_REGEX, SEASON_REGEX } = require("./constants");
const logger = require("./logger");
const { partial } = require("./utils");

function compareFileTrees(a, b) {
	const cmp = (elOfA, elOfB) => {
		const lengthsAreEqual = elOfB.length === elOfA.length;
		const pathsAreEqual = elOfB.path === elOfA.path;

		// https://github.com/mmgoodnow/cross-seed/issues/46
		const noSneakyZeroLengthPathSegments =
			elOfA.pathSegments.length === elOfB.pathSegments.length;

		return (
			lengthsAreEqual && pathsAreEqual && noSneakyZeroLengthPathSegments
		);
	};
	return a.every((elOfA) => b.some((elOfB) => cmp(elOfA, elOfB)));
}

function sizeDoesMatch(result, ogInfo) {
	const { length } = ogInfo;
	const lowerBound = length - 0.02 * length;
	const upperBound = length + 0.02 * length;
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
	const { TrackerId: tracker, Link, Title } = result;
	const logReason = partial(
		logger.verbose,
		"[decide]",
		`${Title} from ${tracker} did not match ${ogInfo.name} because`
	);
	if (!sizeDoesMatch(result, ogInfo)) {
		logReason(
			`its size, ${result.Size}, does not match the original torrent's size, ${ogInfo.length}`
		);
		return null;
	}

	if (!Link) {
		logReason("it doesn't have a download link");
		return null;
	}

	const info = await parseTorrentFromURL(Link);

	// if you got rate limited or some other failure
	if (!info) return info;

	if (hashesToExclude.includes(info.infoHash)) {
		logReason("the info hash matches a torrent you already have");
		return null;
	}
	if (!compareFileTrees(info.files, ogInfo.files)) {
		logReason("it has a different file tree");
		return null;
	}

	const tag = getTag(info.name);
	return { tracker, tag, info };
}

function assessResultCaching(result, ogInfo, hashesToExclude) {
	const { Guid, Title, TrackerId: tracker } = result;
	const cacheKey = `${ogInfo.name}|${Guid}`;
	if (cache.get(cache.CACHE_NAMESPACE_REJECTIONS, cacheKey)) {
		const logReason = partial(
			logger.verbose,
			"[decide]",
			`${Title} from ${tracker} did not match ${ogInfo.name} because`
		);
		logReason("it has been seen and rejected before");
		return null;
	}
	const assessPromise = assessResultHelper(result, ogInfo, hashesToExclude);
	assessPromise.then((assessed) => {
		if (!assessed) {
			cache.save(cache.CACHE_NAMESPACE_REJECTIONS, cacheKey);
		}
	});
	return assessPromise;
}

module.exports = { assessResult: assessResultCaching };
