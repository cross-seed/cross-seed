import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

export const PROGRAM_NAME = packageDotJson.name;
export const PROGRAM_VERSION = packageDotJson.version;
export const USER_AGENT = `CrossSeed/${PROGRAM_VERSION}`;
export const TORRENT_TAG = "cross-seed";
export const TORRENT_CATEGORY_SUFFIX = `.cross-seed`;
export const NEWLINE_INDENT = "\n\t\t\t\t";

export const EP_REGEX =
	/^(?<title>.+?)[_.\s-]+(?:(?<season>S\d+)?[_.\s-]{0,3}(?!(?:19|20)\d{2})(?<episode>(?:E|(?<=S\d+[_\s-]{1,3}))\d+(?:[\s-]?(?!(?:19|20)\d{2})E?\d+)?(?![pix]))(?!\d+[pix])|(?<date>(?<year>(?:19|20)\d{2})[_.\s-](?<month>\d{2})[_.\s-](?<day>\d{2})))/i;
export const IS_MULTI_EP_REGEX = /E\d+(?:[-.]?S\d+E\d|[-.]?E\d|[-.]\d)/i;
export const SEASON_REGEX =
	/^(?<title>.+?)[[_.\s-]+(?<season>S\d+)(?:[_.\s~-]*?(?<seasonmax>S?\d+))?(?=\b(?!E\d+))/i;
export const MOVIE_REGEX =
	/^(?<title>.+?)-?[_.\s][[(]?(?<year>(?:18|19|20)\d{2})[)\]]?(?![pix])/i;
export const ANIME_REGEX =
	/^(?:\[(?<group>.*?)\][_\s-]?)?(?:\[?(?<title>.+?)[_\s-]?(?:\(?(?:\d{1,2}(?:st|nd|rd|th))?\s?Season)?[_\s-]?\]?)(?:[([~/|-]\s?(?!\d{1,4})(?<altTitle>.+?)[)\]~-]?\s?)?[_\s-]?(?:[[(]?(?<year>(?:19|20)\d{2})[)\]]?)?[[_\s-](?:S\d{1,2})?[_\s-]{0,3}(?:#|EP?|(?:SP))?[_\s-]{0,3}(?!\d+[a-uw-z])(?<release>\d{1,4})(?!\.[0-46-9])/i;
export const RELEASE_GROUP_REGEX =
	/(?<=-)(?:\W|\b)(?!(?:\d{3,4}[ip]))(?!\d+\b)(?:\W|\b)(?<group>[\w .]+?)(?:\[.+\])?(?:\))?(?:\s\[.+\])?$/i;
export const ANIME_GROUP_REGEX = /^\s*\[(?<group>.+?)\]/i;
export const RESOLUTION_REGEX = /\b(?<res>\d{3,4}[pix](?:\d{3,4}[pi]?)?)\b/i;
export const RES_STRICT_REGEX = /(?<res>(?:2160|1080|720)[pi])/;
export const YEAR_REGEX = /(?<year>(?:19|20)\d{2})(?![pix])/i;
export const REPACK_PROPER_REGEX =
	/(?:\b(?<type>(?:REPACK|PROPER|\d\v\d)\d?))\b/i;
export const ARR_PROPER_REGEX = /(?:\b(?<arrtype>(?:Proper|v\d)))\b/;
export const SCENE_TITLE_REGEX = /^(?:[a-z0-9]{0,5}-)?(?<title>.*)/;
export const ARR_DIR_REGEX =
	/^(?<title>(?!.*(?:(\d{3,4}[ipx])|([xh.]+26[4-6])|(mpeg)|(xvid)|(?:(he)|a)vc))[\p{L}\s:\w'’!();.,&–+-]+(?:\(\d{4}\))?)(?<id>\s[{[](?:tm|tv|im)db(?:id)?-\w+?[}\]])?$/iu;
export const SONARR_SUBFOLDERS_REGEX =
	/^(?:S(?:eason )?(?<seasonNum>\d{1,4}))$/i;
export const NON_UNICODE_ALPHANUM_REGEX = /[^\p{L}\p{N}]+/giu;

// Needs to be handled through helper functions since there are variations
const SOURCE_REGEXES = {
	AMZN: /\b(amzn|amazon(hd)?)\b[ ._-]web[ ._-]?(dl|rip)?\b/i,
	DSNP: /\b(dsnp|dsny|disney)\b/i,
	NF: /\b(nf|netflix(u?hd)?)\b/i,
	HULU: /\b(hulu)\b/i,
	ATVP: /\b(atvp|aptv)\b/i,
	HBO: /\b(hbo)(?![ ._-]max)\b|\b(hmax|hbom|hbo[ ._-]max)\b/i,
	PCOK: /\b(pcok)\b/i,
	PMTP: /\b(pmtp|Paramount Plus)\b/i,
};
export function parseSource(title: string): string | null {
	for (const [source, regex] of Object.entries(SOURCE_REGEXES)) {
		if (regex.test(title)) return source;
	}
	return null;
}
export function sourceRegexRemove(title: string): string {
	const originalLength = title.length;
	for (const regex of Object.values(SOURCE_REGEXES)) {
		const newTitle = title.replace(regex, "");
		if (newTitle.length !== originalLength) return newTitle;
	}
	return title;
}

export const VIDEO_EXTENSIONS = [".mkv", ".mp4", ".avi", ".ts"];
export const AUDIO_EXTENSIONS = [
	".wav",
	".aiff",
	".alac",
	".flac",
	".ape",
	".mp3",
	".aac",
	".m4a",
	".m4b",
	".m4p",
	".ogg",
	".wma",
	".aa",
	".aax",
];
export const BOOK_EXTENSIONS = [
	".epub",
	".mobi",
	".azw",
	".azw3",
	".azw4",
	".pdf",
	".djvu",
	".html",
	".chm",
	".cbr",
	".cbz",
	".cb7",
	".cbt",
	".cba",
];
export const ALL_EXTENSIONS = [
	...VIDEO_EXTENSIONS,
	...AUDIO_EXTENSIONS,
	...BOOK_EXTENSIONS,
];

export const TORRENT_CACHE_FOLDER = "torrent_cache";
export const UNKNOWN_TRACKER = "UnknownTracker";

export enum Action {
	SAVE = "save",
	INJECT = "inject",
}

export enum InjectionResult {
	SUCCESS = "INJECTED",
	FAILURE = "FAILURE",
	ALREADY_EXISTS = "ALREADY_EXISTS",
	TORRENT_NOT_COMPLETE = "TORRENT_NOT_COMPLETE",
}

export enum SaveResult {
	SAVED = "SAVED",
}

export type ActionResult = InjectionResult | SaveResult;

export enum Decision {
	MATCH = "MATCH",
	MATCH_SIZE_ONLY = "MATCH_SIZE_ONLY",
	MATCH_PARTIAL = "MATCH_PARTIAL",
	FUZZY_SIZE_MISMATCH = "FUZZY_SIZE_MISMATCH",
	SIZE_MISMATCH = "SIZE_MISMATCH",
	PARTIAL_SIZE_MISMATCH = "PARTIAL_SIZE_MISMATCH",
	NO_DOWNLOAD_LINK = "NO_DOWNLOAD_LINK",
	DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
	MAGNET_LINK = "MAGNET_LINK",
	RATE_LIMITED = "RATE_LIMITED",
	INFO_HASH_ALREADY_EXISTS = "INFO_HASH_ALREADY_EXISTS",
	FILE_TREE_MISMATCH = "FILE_TREE_MISMATCH",
	RELEASE_GROUP_MISMATCH = "RELEASE_GROUP_MISMATCH",
	BLOCKED_RELEASE = "BLOCKED_RELEASE",
	PROPER_REPACK_MISMATCH = "PROPER_REPACK_MISMATCH",
	RESOLUTION_MISMATCH = "RESOLUTION_MISMATCH",
	SOURCE_MISMATCH = "SOURCE_MISMATCH",
}
export type DecisionAnyMatch =
	| Decision.MATCH
	| Decision.MATCH_SIZE_ONLY
	| Decision.MATCH_PARTIAL;
export function isAnyMatchedDecision(
	decision: Decision,
): decision is DecisionAnyMatch {
	return (
		decision === Decision.MATCH ||
		decision === Decision.MATCH_SIZE_ONLY ||
		decision === Decision.MATCH_PARTIAL
	);
}
export function isStaticDecision(decision: Decision): boolean {
	return (
		decision === Decision.RELEASE_GROUP_MISMATCH ||
		decision === Decision.RESOLUTION_MISMATCH ||
		decision === Decision.SOURCE_MISMATCH ||
		decision === Decision.PROPER_REPACK_MISMATCH ||
		decision === Decision.MAGNET_LINK
	);
}

export enum MatchMode {
	SAFE = "safe",
	RISKY = "risky",
	PARTIAL = "partial",
}

export enum LinkType {
	SYMLINK = "symlink",
	HARDLINK = "hardlink",
}

export const IGNORED_FOLDERS_SUBSTRINGS = [
	"sample",
	"proof",
	"bdmv",
	"bdrom",
	"certificate",
	"video_ts",
];
