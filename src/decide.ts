import { existsSync, writeFileSync, utimesSync } from "fs";
import path from "path";
import { appDir } from "./configuration.js";
import {
	Decision,
	DECISION_ALL_MATCH,
	DECISION_NEVER_RETRY,
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
import {
	getFuzzySizeFactor,
	getMinSizeRatio,
	humanReadableSize,
} from "./utils.js";

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
		const sizeDiff = candidate.size
			? candidate.size - searchee.length
			: undefined;

		let reason;
		switch (decision) {
			case Decision.MATCH_PARTIAL:
				return;
			case Decision.MATCH_SIZE_ONLY:
				return;
			case Decision.MATCH:
				return;
			case Decision.FUZZY_SIZE_MISMATCH ||
				Decision.SIZE_MISMATCH ||
				Decision.PARTIAL_SIZE_MISMATCH:
				reason = `its size does not match by ${decision}${
					sizeDiff === undefined
						? ""
						: ` - (${
								Math.abs(sizeDiff) > 10000000 // 10MB is the rounding error
									? `${humanReadableSize(searchee.length)} -> ${humanReadableSize(candidate.size)}`
									: `${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes`
							})`
				}`;
				break;
			case Decision.RESOLUTION_MISMATCH:
				reason = `its resolution does not match - (${
					searchee.name.match(RES_STRICT_REGEX)?.groups?.res
				} -> ${candidate.name.match(RES_STRICT_REGEX)?.groups?.res})`;
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
				reason = `it has a different release group - (${searchee.name
					.match(RELEASE_GROUP_REGEX)
					?.groups?.group?.trim()} -> ${candidate.name
					.match(RELEASE_GROUP_REGEX)
					?.groups?.group?.trim()})`;
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
		logReason(reason);
	};

export function compareFileTrees(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	let cmp: (elOfA: File, elOfB: File) => boolean;
	if (!searchee.infoHash && !searchee.path) {
		// Absolute path so need name
		cmp = (elOfA: File, elOfB: File) => {
			const lengthsAreEqual = elOfB.length === elOfA.length;
			const namesAreEqual = elOfB.name === elOfA.name;
			return lengthsAreEqual && namesAreEqual;
		};
	} else {
		cmp = (elOfA: File, elOfB: File) => {
			const lengthsAreEqual = elOfB.length === elOfA.length;
			const pathsAreEqual = elOfB.path === elOfA.path;
			return lengthsAreEqual && pathsAreEqual;
		};
	}

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

export function comparePartialSizeOnly(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	let matchedSizes = 0;
	for (const candidateFile of candidate.files) {
		const searcheeHasFileSize = searchee.files.some(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (searcheeHasFileSize) {
			matchedSizes += candidateFile.length;
		}
	}
	return matchedSizes / candidate.length >= getMinSizeRatio(searchee);
}

export function compareFileTreesPartial(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
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
	return availablePieces / totalPieces >= getMinSizeRatio(searchee);
}

function fuzzySizeDoesMatch(resultSize: number, searchee: Searchee) {
	const fuzzySizeFactor = getFuzzySizeFactor(searchee);

	const { length } = searchee;
	const lowerBound = length - fuzzySizeFactor * length;
	const upperBound = length + fuzzySizeFactor * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}
function resDoesMatch(
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
	return searcheeRes.startsWith(candidateRes);
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
		.match(RELEASE_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	const candidateReleaseGroup = candidateName
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

export async function assessCandidateHelper(
	metaOrCandidate: Candidate | Metafile,
	searchee: Searchee,
	hashesToExclude: string[],
): Promise<ResultAssessment> {
	const { matchMode, blockList } = getRuntimeConfig();

	// When metaOrCandidate is a Metafile, skip straight to the
	// main matching algorithms as we don't need pre-download filtering.
	const isCandidate = !(metaOrCandidate instanceof Metafile);
	const name = metaOrCandidate.name;
	const size = isCandidate ? metaOrCandidate.size : metaOrCandidate.length;

	if (isCandidate) {
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
			if (!resDoesMatch(searchee.name, name, matchMode)) {
				return { decision: Decision.RESOLUTION_MISMATCH };
			}
		}
		if (!metaOrCandidate.link) {
			return { decision: Decision.NO_DOWNLOAD_LINK };
		}
	}

	if (findBlockedStringInReleaseMaybe(searchee, blockList)) {
		return { decision: Decision.BLOCKED_RELEASE };
	}

	let metafile: Metafile;
	if (isCandidate) {
		const result = await snatch(metaOrCandidate);
		if (result.isErr()) {
			const err = result.unwrapErrOrThrow();
			return err === SnatchError.RATE_LIMITED
				? { decision: Decision.RATE_LIMITED }
				: err === SnatchError.MAGNET_LINK
					? { decision: Decision.MAGNET_LINK }
					: { decision: Decision.DOWNLOAD_FAILED };
		}
		metafile = result.unwrapOrThrow();
		cacheTorrentFile(metafile);
		metaOrCandidate.size = metafile.length; // Trackers can be wrong
	} else {
		metafile = metaOrCandidate;
	}

	if (hashesToExclude.includes(metafile.infoHash)) {
		return { decision: Decision.INFO_HASH_ALREADY_EXISTS, metafile };
	}

	const perfectMatch = compareFileTrees(metafile, searchee);
	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile };
	}

	const sizeMatch = compareFileTreesIgnoringNames(metafile, searchee);
	if (
		sizeMatch &&
		searchee.files.length === 1 &&
		matchMode !== MatchMode.SAFE
	) {
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

function existsInTorrentCache(infoHash: string | undefined): boolean {
	if (!infoHash) return false;
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
	const torrentPath = path.join(
		appDir(),
		TORRENT_CACHE_FOLDER,
		`${meta.infoHash}.cached.torrent`,
	);
	if (existsInTorrentCache(meta.infoHash)) {
		utimesSync(torrentPath, new Date(), new Date());
		return;
	}
	writeFileSync(torrentPath, meta.encode());
}

async function assessAndSaveResults(
	metaOrCandidate: Candidate | Metafile,
	searchee: Searchee,
	guid: string,
	infoHashesToExclude: string[],
	firstSeen: number,
) {
	const assessment = await assessCandidateHelper(
		metaOrCandidate,
		searchee,
		infoHashesToExclude,
	);

	await db.transaction(async (trx) => {
		const { id } = await trx("searchee")
			.select("id")
			.where({ name: searchee.name })
			.first();
		await trx("decision")
			.insert({
				searchee_id: id,
				guid: guid,
				info_hash: assessment.metafile?.infoHash ?? null,
				decision: assessment.decision,
				first_seen: firstSeen,
				last_seen: Date.now(),
				fuzzy_size_factor: getFuzzySizeFactor(searchee),
			})
			.onConflict(["searchee_id", "guid"])
			.merge();
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
			id: "decision.id",
			infoHash: "decision.info_hash",
			decision: "decision.decision",
			firstSeen: "decision.first_seen",
			fuzzySizeFactor: "decision.fuzzy_size_factor",
		})
		.join("searchee", "decision.searchee_id", "searchee.id")
		.where({ name: searchee.name, guid })
		.first();
	const metaInfoHash: string | undefined = (
		await db("decision")
			.select({ infoHash: "decision.info_hash" })
			.where({ guid })
			.whereNotNull("info_hash")
			.first()
	)?.infoHash; // Can be from a previous similar searchee's snatch
	const metaOrCandidate = existsInTorrentCache(metaInfoHash)
		? await getCachedTorrentFile(metaInfoHash!)
		: candidate;
	if (metaOrCandidate instanceof Metafile) {
		logger.verbose({
			label: Label.DECIDE,
			message: `Using cached .torrent [${metaInfoHash}] for ${tracker} assessment ${name}`,
		});
		candidate.size = metaOrCandidate.length; // Trackers can be wrong
	}

	let assessment: ResultAssessment;
	if (!cacheEntry?.decision) {
		// New candiate, could be metafile from cache
		assessment = await assessAndSaveResults(
			metaOrCandidate,
			searchee,
			guid,
			infoHashesToExclude,
			Date.now(),
		);
	} else if (
		DECISION_ALL_MATCH.includes(cacheEntry.decision) &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// Already injected fast path, preserve match decision
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision").where({ id: cacheEntry.id }).update({
			last_seen: Date.now(),
		});
	} else if (DECISION_NEVER_RETRY.includes(cacheEntry.decision)) {
		// These decisions will never change unless we update their logic
		assessment = { decision: cacheEntry.decision };
		await db("decision").where({ id: cacheEntry.id }).update({
			last_seen: Date.now(),
		});
	} else {
		// Re-assess decisions using Metafile if cached
		if (
			cacheEntry.decision !== Decision.FUZZY_SIZE_MISMATCH ||
			cacheEntry.fuzzySizeFactor < getFuzzySizeFactor(searchee)
		) {
			assessment = await assessAndSaveResults(
				metaOrCandidate,
				searchee,
				guid,
				infoHashesToExclude,
				cacheEntry.firstSeen,
			);
		} else {
			assessment = { decision: Decision.FUZZY_SIZE_MISMATCH };
			await db("decision").where({ id: cacheEntry.id }).update({
				last_seen: Date.now(),
			});
		}
	}
	const wasCached = cacheEntry?.decision === assessment.decision;
	logReason(assessment.decision, wasCached, searchee, candidate);

	return assessment;
}

export { assessCandidateCaching as assessCandidate };
