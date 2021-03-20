import { Metafile } from "parse-torrent";
import {
	Decision,
	DECISIONS,
	EP_REGEX,
	FailureDecision,
	MOVIE_REGEX,
	PermanentDecisions,
	SEASON_REGEX,
} from "./constants";
import db, { DecisionEntry } from "./db";
import { JackettResult } from "./jackett";
import * as logger from "./logger";
import { parseTorrentFromURL } from "./torrent";
import { partial } from "./utils";

export interface SuccessfulResultAssessment {
	decision: Decision.MATCH;
	tracker: string;
	tag: string;
	info: Metafile;
}

export type ResultAssessment =
	| { decision: FailureDecision }
	| SuccessfulResultAssessment;

const createReasonLogger = (Title: string, tracker: string, name: string) => (
	decision: Decision,
	cached = false
): void => {
	const logReason = partial(
		logger.verbose,
		"[decide]",
		name,
		"- no match for",
		tracker,
		"torrent",
		Title,
		"-"
	);
	let reason;
	switch (decision) {
		case Decision.MATCH:
			return;
		case Decision.SIZE_MISMATCH:
			reason = "its size does not match";
			break;
		case Decision.NO_DOWNLOAD_LINK:
			reason = "it doesn't have a download link";
			break;
		case Decision.DOWNLOAD_FAILED:
			reason = "the torrent file failed to download";
			break;
		case Decision.INFO_HASH_ALREADY_EXISTS:
			reason = "the info hash matches a torrent you already have";
			break;
		case Decision.FILE_TREE_MISMATCH:
			reason = "it has a different file tree";
			break;
		case Decision.UNKNOWN:
			reason = "of an unknown error";
			break;
	}
	if (cached) logReason(reason, "(cached)");
	else logReason(reason);
};

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
	const { TrackerId: tracker, Link } = result;
	if (!sizeDoesMatch(result, ogInfo)) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	if (!Link) return { decision: Decision.NO_DOWNLOAD_LINK };

	const info = await parseTorrentFromURL(Link);

	if (!info) return { decision: Decision.DOWNLOAD_FAILED };

	if (hashesToExclude.includes(info.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS };
	}

	if (!compareFileTrees(info, ogInfo)) {
		return { decision: Decision.FILE_TREE_MISMATCH };
	}

	const tag = getTag(info.name);
	return { decision: Decision.MATCH, tracker, tag, info };
}

async function assessResultCaching(
	result: JackettResult,
	ogInfo: Metafile,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
	const { Guid, Title, TrackerId: tracker } = result;
	const logReason = createReasonLogger(Title, tracker, ogInfo.name);

	const cacheEntry: DecisionEntry = db
		.get([DECISIONS, ogInfo.name, Guid])
		.clone()
		.value();

	// handles path creation
	db.get(DECISIONS)
		.defaultsDeep({
			[ogInfo.name]: {
				[Guid]: {
					firstSeen: Date.now(),
				},
			},
		})
		.set([ogInfo.name, Guid, "lastSeen"], Date.now())
		.value();

	const shouldReassess =
		!cacheEntry || !PermanentDecisions.includes(cacheEntry.decision);
	let assessed: ResultAssessment;
	if (shouldReassess) {
		assessed = await assessResultHelper(result, ogInfo, hashesToExclude);
		db.get([DECISIONS, ogInfo.name, Guid])
			.defaults({ firstSeen: Date.now() })
			.set("decision", assessed.decision)
			.value();
		logReason(assessed.decision, false);
	} else {
		// TODO: successes never go through this codepath, but when they do,
		// figure out a way to store the torrents to cache the full return value
		assessed = {
			decision: cacheEntry.decision as FailureDecision,
		};
		logReason(assessed.decision, true);
	}
	db.write();
	return assessed;
}

export { assessResultCaching as assessResult };
