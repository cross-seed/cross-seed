import { existsSync, statSync, utimesSync, writeFileSync } from "fs";
import path from "path";
import { appDir } from "./configuration.js";
import {
	ARR_PROPER_REGEX,
	Decision,
	isAnyMatchedDecision,
	MatchMode,
	RELEASE_GROUP_REGEX,
	REPACK_PROPER_REGEX,
	RES_STRICT_REGEX,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { findBlockedStringInReleaseMaybe } from "./preFilter.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { File, Searchee } from "./searchee.js";
import { parseTorrentFromFilename, snatch, SnatchError } from "./torrent.js";
import { extractInt, humanReadableSize, stripExtension } from "./utils.js";

export interface ResultAssessment {
	decision: Decision;
	metafile?: Metafile;
}

const createReasonLogger =
	(Title: string, tracker: string, name: string) =>
	(
		decision: Decision,
		cached: boolean,
		searchee: Searchee,
		candidate: Candidate,
	): void => {
		if (cached) return;
		function logReason(reason): void {
			logger.verbose({
				label: Label.DECIDE,
				message: `${name} - no match for ${tracker} torrent ${Title} - ${reason}`,
			});
		}

		let reason;
		switch (decision) {
			case Decision.MATCH_PARTIAL:
				return;
			case Decision.MATCH_SIZE_ONLY:
				return;
			case Decision.MATCH:
				return;
			case Decision.FUZZY_SIZE_MISMATCH:
			case Decision.SIZE_MISMATCH:
			case Decision.PARTIAL_SIZE_MISMATCH:
				reason = `its size does not match by ${decision}${
					candidate.size
						? `: ${candidate.size >= searchee.length ? "+" : ""}${humanReadableSize(candidate.size - searchee.length)}`
						: ""
				}`;
				break;
			case Decision.RESOLUTION_MISMATCH:
				reason = `its resolution does not match: ${
					searchee.name.match(RES_STRICT_REGEX)?.groups?.res
				} -> ${candidate.name.match(RES_STRICT_REGEX)?.groups?.res}`;
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
			case Decision.MAGNET_LINK:
				reason = "the torrent is a magnet link";
				break;
			case Decision.INFO_HASH_ALREADY_EXISTS:
				reason = "the info hash matches a torrent you already have";
				break;
			case Decision.FILE_TREE_MISMATCH:
				reason = "it has a different file tree";
				break;
			case Decision.RELEASE_GROUP_MISMATCH:
				reason = `it has a different release group: ${stripExtension(
					searchee.name,
				)
					.match(RELEASE_GROUP_REGEX)
					?.groups?.group?.trim()} -> ${stripExtension(candidate.name)
					.match(RELEASE_GROUP_REGEX)
					?.groups?.group?.trim()}`;
				break;
			case Decision.PROPER_REPACK_MISMATCH:
				reason = `one is a different subsequent release: ${
					searchee.name.match(REPACK_PROPER_REGEX)?.groups?.type ??
					"INITIAL"
				} -> ${candidate.name.match(REPACK_PROPER_REGEX)?.groups?.type ?? "INITIAL"}`;
				break;
			case Decision.BLOCKED_RELEASE:
				reason = `it matches the blocklist: "${findBlockedStringInReleaseMaybe(
					searchee,
					getRuntimeConfig().blockList,
				)}"`;
				break;
			default:
				reason = decision;
				break;
		}
		logReason(reason);
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
	for (const candidateFile of candidate.files) {
		let matchedSearcheeFiles = searchee.files.filter(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (matchedSearcheeFiles.length > 1) {
			matchedSearcheeFiles = matchedSearcheeFiles.filter(
				(searcheeFile) => searcheeFile.name === candidateFile.name,
			);
		}
		if (matchedSearcheeFiles.length === 0) {
			return false;
		}
	}
	return true;
}

export function comparePartialSizeOnly(
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

function fuzzySizeDoesMatch(resultSize: number, searchee: Searchee) {
	const { fuzzySizeThreshold } = getRuntimeConfig();

	const { length } = searchee;
	const lowerBound = length - fuzzySizeThreshold * length;
	const upperBound = length + fuzzySizeThreshold * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}
function resolutionDoesMatch(
	searcheeName: string,
	candidateName: string,
	matchMode: MatchMode,
) {
	const searcheeRes = searcheeName
		.match(RES_STRICT_REGEX)
		?.groups?.res?.trim()
		?.toLowerCase();
	const candidateRes = candidateName
		.match(RES_STRICT_REGEX)
		?.groups?.res?.trim()
		?.toLowerCase();
	if (searcheeRes === candidateRes) {
		return true;
	}
	// if we are unsure, pass in risky or partial mode but fail in safe mode
	if (!searcheeRes || !candidateRes) {
		return matchMode !== MatchMode.SAFE;
	}
	return extractInt(searcheeRes) === extractInt(candidateRes);
}
function releaseVersionDoesMatch(
	searcheeName: string,
	candidateName: string,
	matchMode: MatchMode,
) {
	const searcheeVersionType =
		stripExtension(searcheeName).match(REPACK_PROPER_REGEX);
	const candidateVersionType =
		stripExtension(candidateName).match(REPACK_PROPER_REGEX);
	const searcheeTypeStr = searcheeVersionType?.groups?.type
		?.trim()
		?.toLowerCase();
	const candidateTypeStr = candidateVersionType?.groups?.type
		?.trim()
		?.toLowerCase();
	const arrProperType =
		stripExtension(searcheeName).match(ARR_PROPER_REGEX)?.groups?.arrtype;

	if (
		searcheeTypeStr !== candidateTypeStr ||
		(arrProperType && candidateVersionType)
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
	const searcheeReleaseGroup = stripExtension(searcheeName)
		.match(RELEASE_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	const candidateReleaseGroup = stripExtension(candidateName)
		.match(RELEASE_GROUP_REGEX)
		?.groups?.group?.trim()
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
	candidate: Candidate,
	searchee: Searchee,
	hashesToExclude: string[],
): Promise<ResultAssessment> {
	const { matchMode, blockList } = getRuntimeConfig();
	const { name, size, link } = candidate;

	if (!releaseGroupDoesMatch(searchee.name, name, matchMode)) {
		return { decision: Decision.RELEASE_GROUP_MISMATCH };
	}
	if (!releaseVersionDoesMatch(searchee.name, name, matchMode)) {
		return { decision: Decision.PROPER_REPACK_MISMATCH };
	}
	if (size) {
		if (!fuzzySizeDoesMatch(size, searchee)) {
			return { decision: Decision.FUZZY_SIZE_MISMATCH };
		}
	} else {
		if (!resolutionDoesMatch(searchee.name, name, matchMode)) {
			return { decision: Decision.RESOLUTION_MISMATCH };
		}
	}
	if (!link) {
		return { decision: Decision.NO_DOWNLOAD_LINK };
	}

	if (findBlockedStringInReleaseMaybe(searchee, blockList)) {
		return { decision: Decision.BLOCKED_RELEASE };
	}

	const result = await snatch(candidate);
	if (result.isErr()) {
		const err = result.unwrapErr();
		return err === SnatchError.RATE_LIMITED
			? { decision: Decision.RATE_LIMITED }
			: err === SnatchError.MAGNET_LINK
				? { decision: Decision.MAGNET_LINK }
				: { decision: Decision.DOWNLOAD_FAILED };
	}
	const metafile = result.unwrap();
	cacheTorrentFile(metafile);
	candidate.size = metafile.length; // Trackers can be wrong

	if (hashesToExclude.includes(metafile.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS, metafile };
	}

	const perfectMatch = compareFileTrees(metafile, searchee);
	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile };
	}

	const sizeMatch = compareFileTreesIgnoringNames(metafile, searchee);
	if (sizeMatch && matchMode !== MatchMode.SAFE) {
		return { decision: Decision.MATCH_SIZE_ONLY, metafile };
	}

	if (matchMode === MatchMode.PARTIAL) {
		const partialSizeMatch = comparePartialSizeOnly(metafile, searchee);
		if (!partialSizeMatch) {
			return { decision: Decision.PARTIAL_SIZE_MISMATCH, metafile };
		}
		const partialMatch = compareFileTreesPartial(metafile, searchee);
		if (partialMatch) {
			return { decision: Decision.MATCH_PARTIAL, metafile };
		}
	} else if (!sizeMatch) {
		return { decision: Decision.SIZE_MISMATCH, metafile };
	}

	return { decision: Decision.FILE_TREE_MISMATCH, metafile };
}

function existsInTorrentCache(infoHash: string): boolean {
	const torrentPath = path.join(
		appDir(),
		TORRENT_CACHE_FOLDER,
		`${infoHash}.cached.torrent`,
	);
	if (!existsSync(torrentPath)) return false;
	utimesSync(torrentPath, new Date(), statSync(torrentPath).mtime);
	return true;
}

async function getCachedTorrentFile(infoHash: string): Promise<Metafile> {
	return parseTorrentFromFilename(
		path.join(appDir(), TORRENT_CACHE_FOLDER, `${infoHash}.cached.torrent`),
	);
}

function cacheTorrentFile(meta: Metafile): void {
	const torrentPath = path.join(
		appDir(),
		TORRENT_CACHE_FOLDER,
		`${meta.infoHash}.cached.torrent`,
	);
	if (existsInTorrentCache(meta.infoHash)) return;
	writeFileSync(torrentPath, meta.encode());
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
			info_hash: assessment.metafile?.infoHash ?? null,
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
		isAnyMatchedDecision(cacheEntry.decision) &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// has been added since the last run
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({ decision: Decision.INFO_HASH_ALREADY_EXISTS });
	} else if (
		isAnyMatchedDecision(cacheEntry.decision) &&
		cacheEntry.infoHash &&
		existsInTorrentCache(cacheEntry.infoHash)
	) {
		// cached match
		assessment = {
			decision: cacheEntry.decision,
			metafile: await getCachedTorrentFile(cacheEntry.infoHash),
		};
	} else if (isAnyMatchedDecision(cacheEntry.decision)) {
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
