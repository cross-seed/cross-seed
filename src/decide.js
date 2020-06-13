const { parseTorrentFromURL } = require("./torrent");

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

async function assessResult(result, ogInfo, hashesToExclude) {
	const { Title, TrackerId: tracker, Link } = result;
	const shouldDownload = assessResultPreDownload(result, ogInfo);
	if (!shouldDownload) {
		console.log(`invalid size for ${Title} on ${tracker}`);
		return null;
	}

	const info = await parseTorrentFromURL(Link).catch((e) => {
		console.error(chalk.red`error parsing torrent at ${Link}`);
		return null;
	});

	// if you got rate limited or some other failure
	if (info === null) return null;
	if (info.length !== ogInfo.length) return null;

	const name = info.name;

	if (hashesToExclude.includes(info.infoHash)) {
		console.log(`hash match for ${name} on ${tracker}`);
		return null;
	}

	if (!compareFileTrees(info.files, ogInfo.files)) {
		console.log(`tree differs for ${name} on ${tracker}`);
		return null;
	}

	const tag = info.files.length === 1 ? "movie" : "pack";

	return { tracker, tag, info };
}

module.exports = { assessResult };
