import { existsSync, statSync, utimesSync, writeFileSync } from "fs";
import path from "path";
import { appDir } from "./configuration.js";
import {
	Decision,
	isAnyMatchedDecision,
	isStaticDecision,
	MatchMode,
	RELEASE_GROUP_REGEX,
	REPACK_PROPER_REGEX,
	RES_STRICT_REGEX,
	parseSource,
	TORRENT_CACHE_FOLDER,
	ANIME_GROUP_REGEX,
} from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { findBlockedStringInReleaseMaybe } from "./preFilter.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { File, Searchee, SearcheeWithLabel } from "./searchee.js";
import { parseTorrentFromFilename, snatch, SnatchError } from "./torrent.js";
import {
	extractInt,
	getFuzzySizeFactor,
	getMinSizeRatio,
	humanReadableSize,
	stripExtension,
	wait,
} from "./utils.js";
import ms from "ms";

export interface ResultAssessment {
	decision: Decision;
	metafile?: Metafile;
}

const createReasonLogger =
	(title: string, tracker: string, name: string) =>
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
				message: `${name} - no match for ${tracker} torrent ${title} - ${reason}`,
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
			case Decision.SOURCE_MISMATCH:
				reason = `it has a different source: ${parseSource(searchee.name)} -> ${parseSource(candidate.name)}`;
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
	let matchedSizes = 0;
	for (const candidateFile of candidate.files) {
		const searcheeHasFileSize = searchee.files.some(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (searcheeHasFileSize) {
			matchedSizes += candidateFile.length;
		}
	}
	return matchedSizes / candidate.length >= getMinSizeRatio();
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
	return availablePieces / totalPieces >= getMinSizeRatio();
}

function fuzzySizeDoesMatch(resultSize: number, searchee: Searchee) {
	const fuzzySizeFactor = getFuzzySizeFactor();

	const { length } = searchee;
	const lowerBound = length - fuzzySizeFactor * length;
	const upperBound = length + fuzzySizeFactor * length;
	return resultSize >= lowerBound && resultSize <= upperBound;
}
function resolutionDoesMatch(searcheeName: string, candidateName: string) {
	const searcheeRes = searcheeName
		.match(RES_STRICT_REGEX)
		?.groups?.res?.trim()
		?.toLowerCase();
	const candidateRes = candidateName
		.match(RES_STRICT_REGEX)
		?.groups?.res?.trim()
		?.toLowerCase();
	if (!searcheeRes || !candidateRes) return true;
	return extractInt(searcheeRes) === extractInt(candidateRes);
}
function releaseGroupDoesMatch(searcheeName: string, candidateName: string) {
	const searcheeReleaseGroup = stripExtension(searcheeName)
		.match(RELEASE_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	const candidateReleaseGroup = stripExtension(candidateName)
		.match(RELEASE_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	if (!searcheeReleaseGroup || !candidateReleaseGroup) {
		return true; // Pass if missing -GRP
	}
	if (
		searcheeReleaseGroup.startsWith(candidateReleaseGroup) ||
		candidateReleaseGroup.startsWith(searcheeReleaseGroup)
	) {
		return true; // -GRP matches
	}

	// Anime naming can cause weird things to match as release groups
	const searcheeAnimeGroup = searcheeName
		.match(ANIME_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	const candidateAnimeGroup = candidateName
		.match(ANIME_GROUP_REGEX)
		?.groups?.group?.trim()
		?.toLowerCase();
	if (!searcheeAnimeGroup && !candidateAnimeGroup) {
		return false;
	}

	// Most checks will never get here, below are rare edge cases
	if (searcheeAnimeGroup === candidateAnimeGroup) {
		return true;
	}
	if (searcheeAnimeGroup && searcheeAnimeGroup === candidateReleaseGroup) {
		return true;
	}
	if (candidateAnimeGroup && searcheeReleaseGroup === candidateAnimeGroup) {
		return true;
	}
	return false;
}
function sourceDoesMatch(searcheeName: string, candidateName: string) {
	const searcheeSource = parseSource(searcheeName);
	const candidateSource = parseSource(candidateName);
	if (!searcheeSource || !candidateSource) return true;
	return searcheeSource === candidateSource;
}

async function assessCandidateHelper(
	metaOrCandidate: Metafile | Candidate,
	searchee: SearcheeWithLabel,
	hashesToExclude: string[],
): Promise<ResultAssessment> {
	const { matchMode, blockList } = getRuntimeConfig();

	// When metaOrCandidate is a Metafile, skip straight to the
	// main matching algorithms as we don't need pre-download filtering.
	const isCandidate = !(metaOrCandidate instanceof Metafile);
	const name = metaOrCandidate.name;
	const size = isCandidate ? metaOrCandidate.size : metaOrCandidate.length;

	if (isCandidate) {
		if (!releaseGroupDoesMatch(searchee.name, name)) {
			return { decision: Decision.RELEASE_GROUP_MISMATCH };
		}
		if (!resolutionDoesMatch(searchee.name, name)) {
			return { decision: Decision.RESOLUTION_MISMATCH };
		}
		if (!sourceDoesMatch(searchee.name, name)) {
			return { decision: Decision.SOURCE_MISMATCH };
		}
		if (size && !fuzzySizeDoesMatch(size, searchee)) {
			return { decision: Decision.FUZZY_SIZE_MISMATCH };
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
		let res = await snatch(metaOrCandidate);
		if (res.isErr()) {
			const e = res.unwrapErr();
			if (
				[Label.ANNOUNCE, Label.RSS].includes(searchee.label) &&
				![SnatchError.RATE_LIMITED, SnatchError.MAGNET_LINK].includes(e)
			) {
				await wait(ms("30 seconds"));
				res = await snatch(metaOrCandidate);
			}
			if (res.isErr()) {
				const err = res.unwrapErr();
				return err === SnatchError.MAGNET_LINK
					? { decision: Decision.MAGNET_LINK }
					: err === SnatchError.RATE_LIMITED
						? { decision: Decision.RATE_LIMITED }
						: { decision: Decision.DOWNLOAD_FAILED };
			}
		}
		metafile = res.unwrap();
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
	metaOrCandidate: Metafile | Candidate,
	searchee: SearcheeWithLabel,
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
				fuzzy_size_factor: getFuzzySizeFactor(),
			})
			.onConflict(["searchee_id", "guid"])
			.merge();
	});
	return assessment;
}

async function assessCandidateCaching(
	candidate: Candidate,
	searchee: SearcheeWithLabel,
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
	const metaOrCandidate = metaInfoHash
		? existsInTorrentCache(metaInfoHash)
			? await getCachedTorrentFile(metaInfoHash)
			: candidate
		: candidate;
	if (metaOrCandidate instanceof Metafile) {
		logger.verbose({
			label: Label.DECIDE,
			message: `Using ${metaInfoHash}.cached.torrent for ${tracker} assessment ${name}`,
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
		isAnyMatchedDecision(cacheEntry.decision) &&
		infoHashesToExclude.includes(cacheEntry.infoHash)
	) {
		// Already injected fast path, preserve match decision
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision").where({ id: cacheEntry.id }).update({
			last_seen: Date.now(),
		});
	} else if (isStaticDecision(cacheEntry.decision)) {
		// These decisions will never change unless we update their logic
		assessment = { decision: cacheEntry.decision };
		await db("decision").where({ id: cacheEntry.id }).update({
			last_seen: Date.now(),
		});
	} else {
		// Re-assess decisions using Metafile if cached
		if (
			cacheEntry.decision !== Decision.FUZZY_SIZE_MISMATCH ||
			cacheEntry.fuzzySizeFactor < getFuzzySizeFactor()
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
