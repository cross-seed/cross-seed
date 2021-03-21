import { existsSync, writeFileSync } from "fs";
import parseTorrent, { Metafile } from "parse-torrent";
import path from "path";
import { appDir } from "./configuration";
import { Decision, DECISIONS, TORRENT_CACHE_FOLDER } from "./constants";
import db, { DecisionEntry } from "./db";
import { JackettResult } from "./jackett";
import * as logger from "./logger";
import { parseTorrentFromFilename, parseTorrentFromURL } from "./torrent";
import { partial } from "./utils";

export interface ResultAssessment {
	decision: Decision;
	info?: Metafile;
}

const createReasonLogger = (Title: string, tracker: string, name: string) => (
	decision: Decision,
	cached
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

function sizeDoesMatch(resultSize, ogInfo) {
	const { length } = ogInfo;
	const lowerBound = length - 0.02 * length;
	const upperBound = length + 0.02 * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}

async function assessResultHelper(
	{ Link, Size }: JackettResult,
	ogInfo: Metafile,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
	if (!sizeDoesMatch(Size, ogInfo)) {
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

	return { decision: Decision.MATCH, info };
}

function existsInCache(infoHash: string): boolean {
	return existsSync(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`)
	);
}

function getCachedTorrentFile(infoHash: string): Metafile {
	return parseTorrentFromFilename(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`)
	);
}

function cacheTorrentFile(meta: Metafile): void {
	writeFileSync(
		path.join(
			appDir(),
			TORRENT_CACHE_FOLDER,
			`${meta.infoHash}.cached.torrent`
		),
		parseTorrent.toTorrentFile(meta)
	);
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

	let assessment: ResultAssessment;
	if (cacheEntry && cacheEntry.decision !== Decision.MATCH) {
		assessment = { decision: cacheEntry.decision };
		logReason(cacheEntry.decision, true);
	} else if (cacheEntry && existsInCache(cacheEntry.infoHash)) {
		assessment = {
			decision: cacheEntry.decision,
			info: getCachedTorrentFile(cacheEntry.infoHash),
		};
	} else {
		assessment = await assessResultHelper(result, ogInfo, hashesToExclude);
		db.set(
			[DECISIONS, ogInfo.name, Guid, "decision"],
			assessment.decision
		).value();
		if (assessment.decision === Decision.MATCH) {
			db.set(
				[DECISIONS, ogInfo.name, Guid, "infoHash"],
				assessment.info.infoHash
			).value();
			cacheTorrentFile(assessment.info);
		}
		logReason(assessment.decision, false);
	}
	db.write();
	return assessment;
}

export { assessResultCaching as assessResult };
