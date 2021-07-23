import { existsSync, writeFileSync } from "fs";
import parseTorrent, { Metafile } from "parse-torrent";
import path from "path";
import { appDir } from "./configuration";
import { Decision, DECISIONS, TORRENT_CACHE_FOLDER } from "./constants";
import db, { DecisionEntry } from "./db";
import { JackettResult } from "./jackett";
import { Label, logger } from "./logger";
import { Searchee } from "./searchee";
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
	function logReason(reason): void {
		logger.verbose({
			label: Label.DECIDE,
			message: `${name} - no match for ${tracker} torrent ${Title} - ${reason}`,
		});
	}
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
	if (cached) logReason(`${reason} (cached)`);
	else logReason(reason);
};

function compareFileTrees(candidate: Metafile, searchee: Searchee): boolean {
	const cmp = (elOfA, elOfB) => {
		const lengthsAreEqual = elOfB.length === elOfA.length;
		const pathsAreEqual = elOfB.path === elOfA.path;

		return lengthsAreEqual && pathsAreEqual;
	};

	return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB))
	);
}

function sizeDoesMatch(resultSize, searchee) {
	const { length } = searchee;
	const lowerBound = length - 0.02 * length;
	const upperBound = length + 0.02 * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}

async function assessResultHelper(
	{ Link, Size }: JackettResult,
	searchee: Searchee,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
	if (!sizeDoesMatch(Size, searchee)) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	if (!Link) return { decision: Decision.NO_DOWNLOAD_LINK };

	const info = await parseTorrentFromURL(Link);

	if (!info) return { decision: Decision.DOWNLOAD_FAILED };

	if (hashesToExclude.includes(info.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS };
	}

	if (!compareFileTrees(info, searchee)) {
		return { decision: Decision.FILE_TREE_MISMATCH };
	}

	return { decision: Decision.MATCH, info };
}

function existsInCache(infoHash: string): boolean {
	return existsSync(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`)
	);
}

async function getCachedTorrentFile(infoHash: string): Promise<Metafile> {
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
	searchee: Searchee,
	infoHashesToExclude: string[]
): Promise<ResultAssessment> {
	const { Guid, Title, TrackerId: tracker } = result;
	const logReason = createReasonLogger(Title, tracker, searchee.name);

	const cacheEntry: DecisionEntry = db
		.get<typeof DECISIONS, typeof searchee.name, typeof Guid>([
			DECISIONS,
			searchee.name,
			Guid,
		])
		.clone()
		.value();

	// handles path creation
	db.get(DECISIONS)
		.defaultsDeep({
			[searchee.name]: {
				[Guid]: {
					firstSeen: Date.now(),
				},
			},
		})
		.set([searchee.name, Guid, "lastSeen"], Date.now())
		.value();

	let assessment: ResultAssessment;
	if (cacheEntry && cacheEntry.decision !== Decision.MATCH) {
		assessment = { decision: cacheEntry.decision };
		logReason(cacheEntry.decision, true);
	} else if (cacheEntry && existsInCache(cacheEntry.infoHash)) {
		if (infoHashesToExclude.includes(cacheEntry.infoHash)) {
			// has been added since the last run
			assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
			db.set(
				[DECISIONS, searchee.name, Guid, "decision"],
				assessment.decision
			).value();
		} else {
			assessment = {
				decision: cacheEntry.decision,
				info: await getCachedTorrentFile(cacheEntry.infoHash),
			};
		}
	} else {
		assessment = await assessResultHelper(
			result,
			searchee,
			infoHashesToExclude
		);
		db.set(
			[DECISIONS, searchee.name, Guid, "decision"],
			assessment.decision
		).value();
		if (assessment.decision === Decision.MATCH) {
			db.set(
				[DECISIONS, searchee.name, Guid, "infoHash"],
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
