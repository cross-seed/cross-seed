import { existsSync, fstat, statSync, writeFileSync } from "fs";
import parseTorrent, { FileListing, Metafile } from "parse-torrent";
import path from "path";
import { appDir } from "./configuration.js";
import { Decision, TORRENT_CACHE_FOLDER } from "./constants.js";
import { Label, logger } from "./logger.js";
import { Candidate } from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { db } from "./db.js";
import { parseTorrentFromFilename, parseTorrentFromURL } from "./torrent.js";
import { File } from "./searchee.js";
export interface ResultAssessment {
	decision: Decision;
	metafile?: Metafile;
}

const createReasonLogger =
	(Title: string, tracker: string, name: string) =>
	(decision: Decision, cached): void => {
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
			default:
				reason = decision;
				break;
		}
		if (cached) logReason(`${reason} (cached)`);
		else logReason(reason);
	};

export function compareFileTrees(
	candidate: Metafile,
	searchee: Searchee
): boolean {
	const cmp = (elOfA: FileListing, elOfB: File) => {
		const lengthsAreEqual = elOfB.length === elOfA.length;
		const pathsAreEqual = elOfB.path === elOfA.path;

		return lengthsAreEqual && pathsAreEqual;
	};

	return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB))
	);
}

export function compareFileTreesIgnoringNames(
	candidate: Metafile,
	searchee: Searchee): boolean {
		const cmp = (candidate, searchee) => {
			return searchee.length === candidate.length;
		};

		return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB,))
	);
	}

function sizeDoesMatch(resultSize, searchee) {
	const { fuzzySizeThreshold } = getRuntimeConfig();

	const { length } = searchee;
	const lowerBound = length - fuzzySizeThreshold * length;
	const upperBound = length + fuzzySizeThreshold * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}

async function assessCandidateHelper(
	{ link, size }: Candidate,
	searchee: Searchee,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
	if (size != null && !sizeDoesMatch(size, searchee)) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	if (!link) return { decision: Decision.NO_DOWNLOAD_LINK };

	const info = await parseTorrentFromURL(link);

	if (!info) return { decision: Decision.DOWNLOAD_FAILED };

	if (hashesToExclude.includes(info.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS };
	}
	const { dataMode } = getRuntimeConfig();
	const perfectMatch = compareFileTrees(info, searchee);
	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile: info};
	}
	if (!statSync(searchee.path).isDirectory() && 
		compareFileTreesIgnoringNames(info, searchee) &&
		dataMode == "risky") {
		return { decision: Decision.MATCH_EXCEPT_PARENT_DIR, metafile: info};
	}
	return { decision: Decision.FILE_TREE_MISMATCH };
	
}

function existsInTorrentCache(infoHash: string): boolean {
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

async function assessAndSaveResults(
	result: Candidate,
	searchee: Searchee,
	guid: string,
	infoHashesToExclude: string[]
) {
	const assessment = await assessCandidateHelper(
		result,
		searchee,
		infoHashesToExclude
	);

	if (assessment.decision === Decision.MATCH ||
		assessment.decision === Decision.MATCH_EXCEPT_PARENT_DIR) {
		cacheTorrentFile(assessment.metafile);
	}

	await db.transaction(async (trx) => {
		const now = Date.now();
		const { id } = await trx("searchee")
			.select("id")
			.where({ name: searchee.name })
			.first();
		await trx("decision").insert({
			searchee_id: id,
			guid: guid,
			decision: assessment.decision,
			info_hash:
				assessment.decision === Decision.MATCH || assessment.decision === Decision.MATCH_EXCEPT_PARENT_DIR
					? assessment.metafile.infoHash
					: null,
			last_seen: now,
			first_seen: now,
		});
	});
	return assessment;
}

async function assessCandidateCaching(
	candidate: Candidate,
	searchee: Searchee,
	infoHashesToExclude: string[]
): Promise<ResultAssessment> {
	const { guid, name, tracker } = candidate;
	const logReason = createReasonLogger(name, tracker, searchee.name);

	const cacheEntry = await db("decision")
		.select("decision.*")
		.join("searchee", "decision.searchee_id", "searchee.id")
		.where({ name: searchee.name, guid })
		.first();
	let assessment: ResultAssessment;

	if (
		!cacheEntry?.decision ||
		cacheEntry.decision === Decision.DOWNLOAD_FAILED
	) {
		assessment = await assessAndSaveResults(
			candidate,
			searchee,
			guid,
			infoHashesToExclude
		);
		logReason(assessment.decision, false);
	} else if (
		cacheEntry.decision === Decision.MATCH || 
		cacheEntry.decision === Decision.MATCH_EXCEPT_PARENT_DIR &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// has been added since the last run
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({ decision: Decision.INFO_HASH_ALREADY_EXISTS });
	} else if (
		cacheEntry.decision === Decision.MATCH || 
		cacheEntry.decision === Decision.MATCH_EXCEPT_PARENT_DIR &&
		existsInTorrentCache(cacheEntry.info_hash)
	) {
		// cached match
		assessment = {
			decision: cacheEntry.decision,
			metafile: await getCachedTorrentFile(cacheEntry.info_hash),
		};
	} else if (
		cacheEntry.decision === Decision.MATCH || 
		cacheEntry.decision === Decision.MATCH_EXCEPT_PARENT_DIR) {
		assessment = await assessAndSaveResults(
			candidate,
			searchee,
			guid,
			infoHashesToExclude
		);
		logReason(assessment.decision, false);
	} else {
		// cached rejection
		assessment = { decision: cacheEntry.decision };
		logReason(cacheEntry.decision, true);
	}
	// if previously known
	if (cacheEntry) {
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({ last_seen: Date.now() });
	}
	return assessment;
}

export { assessCandidateCaching as assessCandidate };
