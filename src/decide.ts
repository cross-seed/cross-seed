import { existsSync, writeFileSync } from "fs";
import path from "path";
import { appDir } from "./configuration.js";
import {
	Decision,
	MatchMode,
	RELEASE_GROUP_REGEX,
	REPACK_PROPER_REGEX,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { findBlockedStringInReleaseMaybe } from "./preFilter.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { File, Searchee } from "./searchee.js";
import {
	parseTorrentFromFilename,
	parseTorrentFromURL,
	SnatchError,
} from "./torrent.js";
import { humanReadableSize } from "./utils.js";

export interface ResultAssessment {
	decision: Decision;
	metafile?: Metafile;
}

const createReasonLogger =
	(Title: string, tracker: string, name: string) =>
	(
		decision: Decision,
		cached,
		searchee: Searchee,
		candidate: Candidate,
	): void => {
		function logReason(reason): void {
			logger.verbose({
				label: Label.DECIDE,
				message: `${name} - no match for ${tracker} torrent ${Title} - ${reason}`,
			});
		}
		const sizeDiff = candidate.size - searchee.length;

		let reason;
		switch (decision) {
			case Decision.MATCH_PARTIAL:
				return;
			case Decision.MATCH_SIZE_ONLY:
				return;
			case Decision.MATCH:
				return;
			case Decision.SIZE_MISMATCH:
				reason = `its size does not match - (${
					Math.abs(sizeDiff) > 10000000 // 10MB is the rounding error
						? `${humanReadableSize(searchee.length)} -> ${humanReadableSize(candidate.size)}`
						: `${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes`
				})`;
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
				reason = `it has a different release group - (${searchee.name
					.match(RELEASE_GROUP_REGEX)?.[0]
					?.trim()} -> ${candidate.name
					.match(RELEASE_GROUP_REGEX)?.[0]
					?.trim()})`;
				break;
			case Decision.PROPER_REPACK_MISMATCH:
				reason = `one is a different subsequent release - (${
					searchee.name.match(REPACK_PROPER_REGEX)?.groups?.type ??
					"INITIAL"
				} -> ${candidate.name.match(REPACK_PROPER_REGEX)?.groups?.type ?? "INITIAL"})`;
				break;
			case Decision.BLOCKED_RELEASE:
				reason = `it matches the blocklist - ("${findBlockedStringInReleaseMaybe(
					searchee,
					getRuntimeConfig().blockList,
				)}")`;
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
	searchee: Searchee,
): boolean {
	const cmp = (elOfA: File, elOfB: File) => {
		const lengthsAreEqual = elOfB.length === elOfA.length;
		const pathsAreEqual = elOfB.path === elOfA.path;

		return lengthsAreEqual && pathsAreEqual;
	};

	return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB)),
	);
}

export function compareFileTreesIgnoringNames(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	const cmp = (candidate, searchee) => {
		return searchee.length === candidate.length;
	};

	return candidate.files.every((elOfA) =>
		searchee.files.some((elOfB) => cmp(elOfA, elOfB)),
	);
}

export function compareFileTreesPartialIgnoringNames(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	const { fuzzySizeThreshold } = getRuntimeConfig();
	let matchedSizes = 0;
	for (const candidateFile of candidate.files) {
		const searcheeHasFileSize = searchee.files.some(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (searcheeHasFileSize) {
			matchedSizes += candidateFile.length;
		}
	}
	return matchedSizes / candidate.length >= 1 - fuzzySizeThreshold;
}

export function compareFileTreesPartial(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	const { fuzzySizeThreshold } = getRuntimeConfig();
	let matchedSizes = 0;
	for (const candidateFile of candidate.files) {
		let matchedSearcheeFiles = searchee.files.filter(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (matchedSearcheeFiles.length > 1) {
			matchedSearcheeFiles = matchedSearcheeFiles.filter(
				(searcheeFile) => searcheeFile.name === candidateFile.name,
			);
		}
		if (matchedSearcheeFiles.length) {
			matchedSizes += candidateFile.length;
		}
	}
	const totalPieces = Math.ceil(candidate.length / candidate.pieceLength);
	const availablePieces = Math.floor(matchedSizes / candidate.pieceLength);
	return availablePieces / totalPieces >= 1 - fuzzySizeThreshold;
}

function sizeDoesMatch(resultSize: number, searchee: Searchee) {
	const { fuzzySizeThreshold } = getRuntimeConfig();

	const { length } = searchee;
	const lowerBound = length - fuzzySizeThreshold * length;
	const upperBound = length + fuzzySizeThreshold * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}
function releaseVersionDoesMatch(
	searcheeName: string,
	candidateName: string,
	matchMode: MatchMode,
) {
	const searcheeVersionType = searcheeName.match(REPACK_PROPER_REGEX);
	const candidateVersionType = candidateName.match(REPACK_PROPER_REGEX);
	const searcheeTypeStr = searcheeVersionType?.groups?.type
		?.trim()
		?.toLowerCase();
	const candidateTypeStr = candidateVersionType?.groups?.type
		?.trim()
		?.toLowerCase();

	if (
		searcheeTypeStr !== candidateTypeStr ||
		searcheeVersionType?.groups?.arrtype
	) {
		return matchMode !== MatchMode.SAFE;
	}
	return true;
}
function releaseGroupDoesMatch(
	searcheeName: string,
	candidateName: string,
	matchMode: MatchMode,
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
	// if we are unsure, pass in risky or partial mode but fail in safe mode
	if (!searcheeReleaseGroup || !candidateReleaseGroup) {
		return matchMode !== MatchMode.SAFE;
	}
	return searcheeReleaseGroup.startsWith(candidateReleaseGroup);
}

async function assessCandidateHelper(
	{ link, size, name }: Candidate,
	searchee: Searchee,
	hashesToExclude: string[],
): Promise<ResultAssessment> {
	const { matchMode, blockList } = getRuntimeConfig();
	if (findBlockedStringInReleaseMaybe(searchee, blockList)) {
		return { decision: Decision.BLOCKED_RELEASE };
	}

	if (size && !sizeDoesMatch(size, searchee)) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	if (!link) return { decision: Decision.NO_DOWNLOAD_LINK };

	if (!releaseGroupDoesMatch(searchee.name, name, matchMode)) {
		return { decision: Decision.RELEASE_GROUP_MISMATCH };
	}
	if (!releaseVersionDoesMatch(searchee.name, name, matchMode)) {
		return { decision: Decision.PROPER_REPACK_MISMATCH };
	}
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
	const perfectMatch = compareFileTrees(candidateMeta, searchee);

	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile: candidateMeta };
	}
	if (
		sizeMatch &&
		matchMode !== MatchMode.SAFE &&
		searchee.files.length === 1
	) {
		return {
			decision: Decision.MATCH_SIZE_ONLY,
			metafile: candidateMeta,
		};
	}

	if (matchMode === MatchMode.PARTIAL) {
		const partialSizeMatch = compareFileTreesPartialIgnoringNames(
			candidateMeta,
			searchee,
		);
		if (!partialSizeMatch) {
			return { decision: Decision.SIZE_MISMATCH };
		}

		const partialMatch = compareFileTreesPartial(candidateMeta, searchee);
		if (partialMatch) {
			return {
				decision: Decision.MATCH_PARTIAL,
				metafile: candidateMeta,
			};
		}
	} else if (!sizeMatch) {
		return { decision: Decision.SIZE_MISMATCH };
	}

	return { decision: Decision.FILE_TREE_MISMATCH };
}

function existsInTorrentCache(infoHash: string): boolean {
	return existsSync(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`),
	);
}

async function getCachedTorrentFile(infoHash: string): Promise<Metafile> {
	return parseTorrentFromFilename(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`),
	);
}

function cacheTorrentFile(meta: Metafile): void {
	writeFileSync(
		path.join(
			appDir(),
			TORRENT_CACHE_FOLDER,
			`${meta.infoHash}.cached.torrent`,
		),
		meta.encode(),
	);
}

async function assessAndSaveResults(
	result: Candidate,
	searchee: Searchee,
	guid: string,
	infoHashesToExclude: string[],
) {
	const assessment = await assessCandidateHelper(
		result,
		searchee,
		infoHashesToExclude,
	);

	if (
		assessment.decision === Decision.MATCH ||
		assessment.decision === Decision.MATCH_SIZE_ONLY ||
		assessment.decision === Decision.MATCH_PARTIAL
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
				assessment.decision === Decision.MATCH_SIZE_ONLY ||
				assessment.decision === Decision.MATCH_PARTIAL
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
	infoHashesToExclude: string[],
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
			infoHashesToExclude,
		);
		logReason(assessment.decision, false, searchee, candidate);
	} else if (
		(cacheEntry.decision === Decision.MATCH ||
			cacheEntry.decision === Decision.MATCH_SIZE_ONLY ||
			cacheEntry.decision === Decision.MATCH_PARTIAL) &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// has been added since the last run
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({ decision: Decision.INFO_HASH_ALREADY_EXISTS });
	} else if (
		(cacheEntry.decision === Decision.MATCH ||
			cacheEntry.decision === Decision.MATCH_SIZE_ONLY ||
			cacheEntry.decision === Decision.MATCH_PARTIAL) &&
		existsInTorrentCache(cacheEntry.infoHash)
	) {
		// cached match
		assessment = {
			decision: cacheEntry.decision,
			metafile: await getCachedTorrentFile(cacheEntry.infoHash),
		};
	} else if (
		cacheEntry.decision === Decision.MATCH ||
		cacheEntry.decision === Decision.MATCH_SIZE_ONLY ||
		cacheEntry.decision === Decision.MATCH_PARTIAL
	) {
		assessment = await assessAndSaveResults(
			candidate,
			searchee,
			guid,
			infoHashesToExclude,
		);
		logReason(assessment.decision, false, searchee, candidate);
	} else {
		// cached rejection
		assessment = { decision: cacheEntry.decision };
		logReason(cacheEntry.decision, true, searchee, candidate);
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
