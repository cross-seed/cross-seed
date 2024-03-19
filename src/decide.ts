import { existsSync, writeFileSync } from "fs";
import path from "path";
import { appDir } from "./configuration.js";
import {
	Decision,
	MatchMode,
	RELEASE_GROUP_REGEX,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { releaseInBlockList } from "./preFilter.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { File, Searchee } from "./searchee.js";
import {
	parseTorrentFromFilename,
	parseTorrentFromURL,
	SnatchError,
} from "./torrent.js";

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
			case Decision.MATCH_SIZE_ONLY:
				return;
			case Decision.MATCH:
				return;
			case Decision.SIZE_MISMATCH:
				reason = "its size does not match";
				break;
			case Decision.NO_DOWNLOAD_LINK:
				reason = "it doesn't have a download link";
				break;
			case Decision.RATE_LIMITED:
				reason = "cross-seed has reached this tracker's rate limit";
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
			case Decision.RELEASE_GROUP_MISMATCH:
				reason = "it has a different release group";
				break;
			case Decision.BLOCKED_RELEASE:
				reason = "it matches the blocklist";
				break;
			default:
				reason = decision;
				break;
		}
		if (!cached) {
			logReason(reason);
		}
	};

export function compareFileTrees(
	candidate: Metafile,
	searchee: Searchee
): boolean {
	const cmp = (elOfA: File, elOfB: File) => {
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
	searchee: Searchee
): boolean {
	const cmp = (candidate, searchee) => {
		return searchee.length === candidate.length;
	};

	return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB))
	);
}

function sizeDoesMatch(resultSize, searchee) {
	const { fuzzySizeThreshold } = getRuntimeConfig();

	const { length } = searchee;
	const lowerBound = length - fuzzySizeThreshold * length;
	const upperBound = length + fuzzySizeThreshold * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}

function releaseGroupDoesMatch(
	searcheeName: string,
	candidateName: string,
	matchMode: MatchMode
) {
	const searcheeReleaseGroup = searcheeName
		.match(RELEASE_GROUP_REGEX)?.[0]
		?.trim()
		?.toLowerCase();
	const candidateReleaseGroup = candidateName
		.match(RELEASE_GROUP_REGEX)?.[0]
		?.trim()
		?.toLowerCase();
	if (searcheeReleaseGroup === candidateReleaseGroup) {
		return true;
	}
	// if we are unsure, pass in risky mode but fail in safe mode
	if (!searcheeReleaseGroup || !candidateReleaseGroup) {
		return matchMode === MatchMode.RISKY;
	}
	return searcheeReleaseGroup.startsWith(candidateReleaseGroup);
}

async function assessCandidateHelper(
	{ link, size, name }: Candidate,
	searchee: Searchee,
	hashesToExclude: string[]
): Promise<ResultAssessment> {
	const { matchMode, blockList } = getRuntimeConfig();
	if (releaseInBlockList(searchee, blockList)) {
		return { decision: Decision.BLOCKED_RELEASE };
	}

	if (size && !sizeDoesMatch(size, searchee)) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	if (!link) return { decision: Decision.NO_DOWNLOAD_LINK };

	if (!releaseGroupDoesMatch(searchee.name, name, matchMode))
		return { decision: Decision.RELEASE_GROUP_MISMATCH };

	const result = await parseTorrentFromURL(link);

	if (result.isErr()) {
		return result.unwrapErrOrThrow() === SnatchError.RATE_LIMITED
			? { decision: Decision.RATE_LIMITED }
			: { decision: Decision.DOWNLOAD_FAILED };
	}

	const candidateMeta = result.unwrapOrThrow();

	if (hashesToExclude.includes(candidateMeta.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS };
	}
	const sizeMatch = compareFileTreesIgnoringNames(candidateMeta, searchee);
	if (!sizeMatch) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	const perfectMatch = compareFileTrees(candidateMeta, searchee);
	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile: candidateMeta };
	}
	if (matchMode == MatchMode.RISKY && searchee.files.length === 1) {
		return { decision: Decision.MATCH_SIZE_ONLY, metafile: candidateMeta };
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
		meta.encode()
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

	if (
		assessment.decision === Decision.MATCH ||
		assessment.decision === Decision.MATCH_SIZE_ONLY
	) {
		cacheTorrentFile(assessment.metafile!);
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
				assessment.decision === Decision.MATCH ||
				assessment.decision === Decision.MATCH_SIZE_ONLY
					? assessment.metafile!.infoHash
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
		.select({
			decision: "decision.decision",
			infoHash: "decision.info_hash",
			id: "decision.id",
		})
		.join("searchee", "decision.searchee_id", "searchee.id")
		.where({ name: searchee.name, guid })
		.first();
	let assessment: ResultAssessment;

	if (
		!cacheEntry?.decision ||
		cacheEntry.decision === Decision.DOWNLOAD_FAILED ||
		cacheEntry.decision === Decision.RATE_LIMITED
	) {
		assessment = await assessAndSaveResults(
			candidate,
			searchee,
			guid,
			infoHashesToExclude
		);
		logReason(assessment.decision, false);
	} else if (
		(cacheEntry.decision === Decision.MATCH ||
			cacheEntry.decision === Decision.MATCH_SIZE_ONLY) &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// has been added since the last run
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({ decision: Decision.INFO_HASH_ALREADY_EXISTS });
	} else if (
		(cacheEntry.decision === Decision.MATCH ||
			cacheEntry.decision === Decision.MATCH_SIZE_ONLY) &&
		existsInTorrentCache(cacheEntry.infoHash)
	) {
		// cached match
		assessment = {
			decision: cacheEntry.decision,
			metafile: await getCachedTorrentFile(cacheEntry.infoHash),
		};
	} else if (
		cacheEntry.decision === Decision.MATCH ||
		cacheEntry.decision === Decision.MATCH_SIZE_ONLY
	) {
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
