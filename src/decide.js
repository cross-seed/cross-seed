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
	if (result.Size < lowerBound || result.Size > upperBound) return false;
	return true;
}

async function assessResult(result, ogInfo, hashesToExclude) {
	const resultInfo = await parseTorrentFromURL(result.Link).catch((e) => {
		console.error(chalk.red`error parsing torrent at ${result.Link}`);
		return null;
	});
	if (resultInfo === null) return null;
	if (resultInfo.length !== ogInfo.length) return null;
	const name = resultInfo.name;
	const ogAnnounce = ogInfo.announce[0];
	const newAnnounce = resultInfo.announce[0];

	if (hashesToExclude.includes(resultInfo.infoHash)) {
		console.log(`hash match for ${name} at ${newAnnounce}`);
		return null;
	}

	if (!compareFileTrees(resultInfo.files, ogInfo.files)) {
		console.log(`trees differ for ${name}: ${ogAnnounce}, ${newAnnounce}`);
		return null;
	}

	const type = resultInfo.files.length === 1 ? "movie" : "packs";

	return {
		tracker: result.TrackerId,
		type,
		info: resultInfo,
	};
}

module.exports = { assessResult };
