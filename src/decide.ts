import { Metafile } from "parse-torrent";
import * as cache from "./cache";
import { EP_REGEX, MOVIE_REGEX, SEASON_REGEX } from "./constants";
import { JackettResult } from "./jackett";
import * as logger from "./logger";
import { parseTorrentFromURL } from "./torrent";
import { partial } from "./utils";

export interface ResultAssessment {
	tracker: string;
	tag: string;
	info: Metafile;
}

function getAllPathDepths(meta: Metafile): number[] {
	if (!meta.info.files) return [0];
	return meta.info.files.map((file) => {
		const pathBufArray = file["path.utf-8"] || file.path;
		return pathBufArray.length;
	});
}

function compareFileTrees(candidate: Metafile, ogMeta: Metafile): boolean {
	const allPathDepthsA = getAllPathDepths(candidate);
	const allPathDepthsB = getAllPathDepths(ogMeta);

	const cmp = (elOfA, elOfB, i, j) => {
		const lengthsAreEqual = elOfB.length === elOfA.length;
		const pathsAreEqual = elOfB.path === elOfA.path;

		// https://github.com/mmgoodnow/cross-seed/issues/46
		const noSneakyZeroLengthPathSegments =
			allPathDepthsA[i] === allPathDepthsB[j];

		return (
			lengthsAreEqual && pathsAreEqual && noSneakyZeroLengthPathSegments
		);
	};

	return candidate.files.every((elOfA, i) =>
		ogMeta.files.some((elOfB, j) => cmp(elOfA, elOfB, i, j))
	);
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

async function assessResultHelper(
	result: JackettResult,
	ogInfo: Metafile,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
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
	if (!info) return null;

	if (hashesToExclude.includes(info.infoHash)) {
		logReason("the info hash matches a torrent you already have");
		return null;
	}
	if (!compareFileTrees(info, ogInfo)) {
		logReason("it has a different file tree");
		return null;
	}

	const tag = getTag(info.name);
	return { tracker, tag, info };
}

function assessResultCaching(
	result: JackettResult,
	ogInfo: Metafile,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
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

export { assessResultCaching as assessResult };
