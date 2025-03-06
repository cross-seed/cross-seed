import bencode from "bencode";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "fs";
import ms from "ms";
import path from "path";
import { appDir } from "./configuration.js";
import {
	ANIME_GROUP_REGEX,
	Decision,
	isAnyMatchedDecision,
	MatchMode,
	parseSource,
	REPACK_PROPER_REGEX,
	RES_STRICT_REGEX,
	SEASON_REGEX,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { Metafile, Torrent } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import {
	findBlockedStringInReleaseMaybe,
	isSingleEpisode,
} from "./preFilter.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import {
	File,
	getReleaseGroup,
	Searchee,
	SearcheeWithLabel,
} from "./searchee.js";
import { parseTorrentFromFilename, snatch, SnatchError } from "./torrent.js";
import {
	extractInt,
	getFuzzySizeFactor,
	getLogString,
	getMediaType,
	getMinSizeRatio,
	sanitizeInfoHash,
	stripExtension,
} from "./utils.js";

export interface ResultAssessment {
	decision: Decision;
	metafile?: Metafile;
	metaCached?: boolean;
}

function logDecision(
	searchee: Searchee,
	candidate: Candidate,
	decision: Decision,
	metafile: Metafile | undefined,
	tracker: string,
	options?: { configOverride: Partial<RuntimeConfig> },
): void {
	const { blockList, matchMode } = getRuntimeConfig(options?.configOverride);

	let reason: string;
	switch (decision) {
		case Decision.MATCH_PARTIAL:
			return;
		case Decision.MATCH_SIZE_ONLY:
			return;
		case Decision.MATCH:
			return;
		case Decision.FUZZY_SIZE_MISMATCH:
			reason = `the total sizes are outside of the fuzzySizeThreshold range: ${Math.abs((candidate.size! - searchee.length) / searchee.length).toFixed(3)} > ${getFuzzySizeFactor(searchee)}`;
			break;
		case Decision.SIZE_MISMATCH:
			reason = `some files are missing or have different sizes${compareFileTreesPartial(metafile!, searchee) ? ` (will match in partial match mode)` : ""}`;
			break;
		case Decision.PARTIAL_SIZE_MISMATCH:
			reason = `too many files are missing or have different sizes: torrent progress would be ${(getPartialSizeRatio(metafile!, searchee) * 100).toFixed(3)}%`;
			break;
		case Decision.RESOLUTION_MISMATCH:
			reason = `its resolution does not match: ${
				searchee.title.match(RES_STRICT_REGEX)?.groups?.res
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
		case Decision.SAME_INFO_HASH:
			reason = "the info hash is the same";
			break;
		case Decision.INFO_HASH_ALREADY_EXISTS:
			reason = "the info hash matches a torrent you already have";
			break;
		case Decision.FILE_TREE_MISMATCH:
			reason = `it has a different file tree${matchMode === MatchMode.STRICT ? " (will match in flexible or partial matchMode)" : ""}`;
			break;
		case Decision.RELEASE_GROUP_MISMATCH:
			reason = `it has a different release group: ${getReleaseGroup(
				stripExtension(searchee.title),
			)} -> ${getReleaseGroup(stripExtension(candidate.name))}`;
			break;
		case Decision.PROPER_REPACK_MISMATCH:
			reason = `one is a different subsequent release: ${
				searchee.title.match(REPACK_PROPER_REGEX)?.groups?.type ??
				"INITIAL"
			} -> ${candidate.name.match(REPACK_PROPER_REGEX)?.groups?.type ?? "INITIAL"}`;
			break;
		case Decision.SOURCE_MISMATCH:
			reason = `it has a different source: ${parseSource(searchee.title)} -> ${parseSource(candidate.name)}`;
			break;
		case Decision.BLOCKED_RELEASE:
			reason = `it matches the blocklist: ${
				findBlockedStringInReleaseMaybe(searchee, blockList) ??
				findBlockedStringInReleaseMaybe(metafile!, blockList)
			}`;
			break;
		default:
			reason = decision;
			break;
	}
	logger.verbose({
		label: Label.DECIDE,
		message: `${getLogString(searchee)} - no match for ${tracker} torrent ${candidate.name}${metafile ? ` [${sanitizeInfoHash(metafile.infoHash)}]` : ""} - ${reason}`,
	});
}

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
	const availableFiles = searchee.files.slice();
	for (const candidateFile of candidate.files) {
		let matchedSearcheeFiles = availableFiles.filter(
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
		const index = availableFiles.indexOf(matchedSearcheeFiles[0]);
		availableFiles.splice(index, 1);
	}
	return true;
}

export function getPartialSizeRatio(
	candidate: Metafile,
	searchee: Searchee,
): number {
	let matchedSizes = 0;
	for (const candidateFile of candidate.files) {
		const searcheeHasFileSize = searchee.files.some(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (searcheeHasFileSize) {
			matchedSizes += candidateFile.length;
		}
	}
	return matchedSizes / candidate.length;
}

export function compareFileTreesPartial(
	candidate: Metafile,
	searchee: Searchee,
): boolean {
	let matchedSizes = 0;
	const availableFiles = searchee.files.slice();
	for (const candidateFile of candidate.files) {
		let matchedSearcheeFiles = availableFiles.filter(
			(searcheeFile) => searcheeFile.length === candidateFile.length,
		);
		if (matchedSearcheeFiles.length > 1) {
			matchedSearcheeFiles = matchedSearcheeFiles.filter(
				(searcheeFile) => searcheeFile.name === candidateFile.name,
			);
		}
		if (matchedSearcheeFiles.length) {
			matchedSizes += candidateFile.length;
			const index = availableFiles.indexOf(matchedSearcheeFiles[0]);
			availableFiles.splice(index, 1);
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

function resolutionDoesMatch(searcheeTitle: string, candidateName: string) {
	const searcheeRes = searcheeTitle
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

function releaseGroupDoesMatch(searcheeTitle: string, candidateName: string) {
	const searcheeReleaseGroup = getReleaseGroup(
		stripExtension(searcheeTitle),
	)?.toLowerCase();
	const candidateReleaseGroup = getReleaseGroup(
		stripExtension(candidateName),
	)?.toLowerCase();

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
	const searcheeAnimeGroup = searcheeTitle
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

function sourceDoesMatch(searcheeTitle: string, candidateName: string) {
	const searcheeSource = parseSource(searcheeTitle);
	const candidateSource = parseSource(candidateName);
	if (!searcheeSource || !candidateSource) return true;
	return searcheeSource === candidateSource;
}

function releaseVersionDoesMatch(searcheeName: string, candidateName: string) {
	return (
		REPACK_PROPER_REGEX.test(searcheeName) ===
		REPACK_PROPER_REGEX.test(candidateName)
	);
}

export async function assessCandidate(
	metaOrCandidate: Metafile | Candidate,
	searchee: SearcheeWithLabel,
	infoHashesToExclude: Set<string>,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<ResultAssessment> {
	const { blockList, includeSingleEpisodes, matchMode } = getRuntimeConfig(
		options?.configOverride,
	);

	// When metaOrCandidate is a Metafile, skip straight to the
	// main matching algorithms as we don't need pre-download filtering.
	const isCandidate = !(metaOrCandidate instanceof Metafile);
	if (isCandidate) {
		const name = metaOrCandidate.name;
		if (!releaseGroupDoesMatch(searchee.title, name)) {
			return { decision: Decision.RELEASE_GROUP_MISMATCH };
		}
		if (!resolutionDoesMatch(searchee.title, name)) {
			return { decision: Decision.RESOLUTION_MISMATCH };
		}
		if (!sourceDoesMatch(searchee.title, name)) {
			return { decision: Decision.SOURCE_MISMATCH };
		}
		if (!releaseVersionDoesMatch(searchee.title, name)) {
			return { decision: Decision.PROPER_REPACK_MISMATCH };
		}
		const size = metaOrCandidate.size;
		if (size && !fuzzySizeDoesMatch(size, searchee)) {
			return { decision: Decision.FUZZY_SIZE_MISMATCH };
		}
		if (!metaOrCandidate.link) {
			return { decision: Decision.NO_DOWNLOAD_LINK };
		}
	}

	let metaCached = !isCandidate;

	if (findBlockedStringInReleaseMaybe(searchee, blockList)) {
		return {
			decision: Decision.BLOCKED_RELEASE,
			metafile: !isCandidate ? metaOrCandidate : undefined,
			metaCached,
		};
	}

	let metafile: Metafile;
	if (isCandidate) {
		const res = await snatch(metaOrCandidate, searchee.label, {
			retries: 4,
			delayMs:
				searchee.label === Label.ANNOUNCE
					? ms("5 minutes")
					: ms("1 minute"),
		});
		if (res.isErr()) {
			const err = res.unwrapErr();
			return err === SnatchError.MAGNET_LINK
				? { decision: Decision.MAGNET_LINK }
				: err === SnatchError.RATE_LIMITED
					? { decision: Decision.RATE_LIMITED }
					: { decision: Decision.DOWNLOAD_FAILED };
		}
		metafile = res.unwrap();
		metaCached = cacheTorrentFile(metafile);
		metaOrCandidate.size = metafile.length; // Trackers can be wrong
	} else {
		metafile = metaOrCandidate;
	}

	if (searchee.infoHash === metafile.infoHash) {
		return { decision: Decision.SAME_INFO_HASH, metafile, metaCached };
	}

	if (infoHashesToExclude.has(metafile.infoHash)) {
		return {
			decision: Decision.INFO_HASH_ALREADY_EXISTS,
			metafile,
			metaCached,
		};
	}

	if (findBlockedStringInReleaseMaybe(metafile, blockList)) {
		return { decision: Decision.BLOCKED_RELEASE, metafile, metaCached };
	}

	// Prevent candidate episodes from matching searchee season packs
	if (
		!includeSingleEpisodes &&
		SEASON_REGEX.test(searchee.title) &&
		isSingleEpisode(metafile, getMediaType(metafile))
	) {
		return { decision: Decision.FILE_TREE_MISMATCH, metafile, metaCached };
	}

	const perfectMatch = compareFileTrees(metafile, searchee);
	if (perfectMatch) {
		return { decision: Decision.MATCH, metafile, metaCached };
	}

	const sizeMatch = compareFileTreesIgnoringNames(metafile, searchee);
	if (sizeMatch && matchMode !== MatchMode.STRICT) {
		return { decision: Decision.MATCH_SIZE_ONLY, metafile, metaCached };
	}

	if (matchMode === MatchMode.PARTIAL) {
		const partialSizeMatch =
			getPartialSizeRatio(metafile, searchee) >=
			getMinSizeRatio(searchee);
		if (!partialSizeMatch) {
			return {
				decision: Decision.PARTIAL_SIZE_MISMATCH,
				metafile,
				metaCached,
			};
		}
		const partialMatch = compareFileTreesPartial(metafile, searchee);
		if (partialMatch) {
			return { decision: Decision.MATCH_PARTIAL, metafile, metaCached };
		}
	} else if (!sizeMatch) {
		return { decision: Decision.SIZE_MISMATCH, metafile, metaCached };
	}

	return { decision: Decision.FILE_TREE_MISMATCH, metafile, metaCached };
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

async function getCachedTorrentFile(
	infoHash: string,
	options: { deleteOnFail: boolean } = { deleteOnFail: true },
): Promise<Result<Metafile, Error>> {
	const torrentPath = path.join(
		appDir(),
		TORRENT_CACHE_FOLDER,
		`${infoHash}.cached.torrent`,
	);
	try {
		return resultOf(await parseTorrentFromFilename(torrentPath));
	} catch (e) {
		logger.error({
			label: Label.DECIDE,
			message: `Failed to parse cached torrent ${sanitizeInfoHash(infoHash)}${options.deleteOnFail ? " - deleting" : ""}: ${e.message}`,
		});
		logger.debug(e);
		if (options.deleteOnFail) {
			unlinkSync(torrentPath);
		}
		return resultOfErr(e);
	}
}

function cacheTorrentFile(meta: Metafile): boolean {
	if (existsInTorrentCache(meta.infoHash)) return false;
	const torrentPath = path.join(
		appDir(),
		TORRENT_CACHE_FOLDER,
		`${meta.infoHash}.cached.torrent`,
	);
	writeFileSync(torrentPath, meta.encode());
	return true;
}

export async function cleanupTorrentCache(): Promise<void> {
	const torrentCacheDir = path.join(appDir(), TORRENT_CACHE_FOLDER);
	const files = readdirSync(torrentCacheDir);
	const now = Date.now();
	for (const file of files) {
		const filePath = path.join(torrentCacheDir, file);
		if (now - statSync(filePath).atimeMs > ms("1 year")) {
			logger.verbose(`Deleting ${filePath}`);
			await db("decision").where("info_hash", file.split(".")[0]).del();
			unlinkSync(filePath);
		}
	}
}

export async function updateTorrentCache(
	oldStr: string,
	newStr: string,
): Promise<void> {
	const torrentCacheDir = path.join(appDir(), TORRENT_CACHE_FOLDER);
	const files = readdirSync(torrentCacheDir);
	console.log(`Found ${files.length} files in cache, processing...`);
	let count = 0;
	for (const file of files) {
		const filePath = path.join(torrentCacheDir, file);
		try {
			const torrent: Torrent = bencode.decode(readFileSync(filePath));
			const announce = torrent.announce?.toString();
			const announceList = torrent["announce-list"]?.map((tier) =>
				tier.map((url) => url.toString()),
			);
			if (
				!announce?.includes(oldStr) &&
				!announceList?.some((t) =>
					t.some((url) => url.includes(oldStr)),
				)
			) {
				continue;
			}
			count++;
			console.log(`#${count}: ${filePath}`);
			let updated = false;
			if (announce) {
				const newAnnounce = announce.replace(oldStr, newStr);
				if (announce !== newAnnounce) {
					updated = true;
					console.log(`--- ${announce} -> ${newAnnounce}`);
					torrent.announce = Buffer.from(newAnnounce);
				}
			}
			if (announceList) {
				torrent["announce-list"] = announceList.map((tier) =>
					tier.map((url) => {
						const newAnnounce = url.replace(oldStr, newStr);
						if (url === newAnnounce) return Buffer.from(url);
						updated = true;
						console.log(`--- ${url} -> ${newAnnounce}`);
						return Buffer.from(newAnnounce);
					}),
				);
			}
			if (updated) writeFileSync(filePath, bencode.encode(torrent));
		} catch (e) {
			console.error(`Error reading ${filePath}: ${e}`);
		}
	}
}

async function assessAndSaveResults(
	metaOrCandidate: Metafile | Candidate,
	searchee: SearcheeWithLabel,
	guid: string,
	infoHashesToExclude: Set<string>,
	firstSeen: number,
	guidInfoHashMap: Map<string, string>,
	options?: { configOverride: Partial<RuntimeConfig> },
) {
	const assessment = await assessCandidate(
		metaOrCandidate,
		searchee,
		infoHashesToExclude,
		options,
	);

	if (assessment.metaCached && assessment.metafile) {
		guidInfoHashMap.set(guid, assessment.metafile.infoHash);
		await db.transaction(async (trx) => {
			const { id } = await trx("searchee")
				.select("id")
				.where({ name: searchee.title })
				.first();
			await trx("decision")
				.insert({
					searchee_id: id,
					guid: guid,
					info_hash: assessment.metafile!.infoHash,
					decision: assessment.decision,
					first_seen: firstSeen,
					last_seen: Date.now(),
					fuzzy_size_factor: getFuzzySizeFactor(searchee),
				})
				.onConflict(["searchee_id", "guid"])
				.merge();
		});
	}

	return assessment;
}

export async function getGuidInfoHashMap(): Promise<Map<string, string>> {
	return new Map(
		(
			await db("decision")
				.select("guid", "info_hash")
				.whereNotNull("info_hash")
		).map(({ guid, info_hash }) => [guid, info_hash]),
	);
}

/**
 * Some trackers have alt titles which get their own guid but resolve to same torrent
 * @param guid The guid of the candidate
 * @param link The link of the candidate
 * @param guidInfoHashMap The map of guids to info hashes. Necessary for optimal fuzzy lookups.
 * @returns The info hash of the torrent if found
 */
async function guidLookup(
	guid: string,
	link: string,
	guidInfoHashMap: Map<string, string>,
): Promise<string | undefined> {
	const infoHash = guidInfoHashMap.get(guid) ?? guidInfoHashMap.get(link);
	if (infoHash) return infoHash;

	for (const guidOrLink of [guid, link]) {
		if (!guidOrLink.includes(".tv/torrent/")) continue;
		const torrentIdRegex = /\.tv\/torrent\/(\d+)\/group/;
		const torrentIdStr = guidOrLink.match(torrentIdRegex)?.[1];
		if (!torrentIdStr) continue;
		for (const [key, value] of guidInfoHashMap) {
			if (key.match(torrentIdRegex)?.[1] === torrentIdStr) {
				return value;
			}
		}
	}
}

export async function assessCandidateCaching(
	candidate: Candidate,
	searchee: SearcheeWithLabel,
	infoHashesToExclude: Set<string>,
	guidInfoHashMap: Map<string, string>,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<ResultAssessment> {
	const { name, guid, link, tracker } = candidate;

	const cacheEntry = await db("decision")
		.select({
			id: "decision.id",
			infoHash: "decision.info_hash",
			decision: "decision.decision",
			firstSeen: "decision.first_seen",
			fuzzySizeFactor: "decision.fuzzy_size_factor",
		})
		.join("searchee", "decision.searchee_id", "searchee.id")
		.where({ name: searchee.title, guid })
		.first();
	const metaInfoHash = await guidLookup(guid, link, guidInfoHashMap);
	const metaOrCandidate = metaInfoHash
		? existsInTorrentCache(metaInfoHash)
			? (await getCachedTorrentFile(metaInfoHash)).orElse(candidate)
			: candidate
		: candidate;
	if (metaOrCandidate instanceof Metafile) {
		logger.verbose({
			label: Label.DECIDE,
			message: `Using cached torrent ${sanitizeInfoHash(metaInfoHash!)} for ${tracker} assessment ${name}`,
		});
		candidate.size = metaOrCandidate.length; // Trackers can be wrong
	}

	let assessment: ResultAssessment;
	if (infoHashesToExclude.has(cacheEntry?.infoHash)) {
		// Already injected fast path, preserve match decision
		assessment = { decision: Decision.INFO_HASH_ALREADY_EXISTS };
		await db("decision")
			.where({ id: cacheEntry.id })
			.update({
				last_seen: Date.now(),
				decision: isAnyMatchedDecision(cacheEntry.decision)
					? cacheEntry.decision
					: Decision.INFO_HASH_ALREADY_EXISTS,
			});
	} else {
		assessment = await assessAndSaveResults(
			metaOrCandidate,
			searchee,
			guid,
			infoHashesToExclude,
			cacheEntry?.firstSeen ?? Date.now(),
			guidInfoHashMap,
			options,
		);
	}

	logDecision(
		searchee,
		candidate,
		assessment.decision,
		assessment.metafile,
		tracker,
		options,
	);

	return assessment;
}
