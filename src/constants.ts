import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

export const PROGRAM_NAME = packageDotJson.name;
export const PROGRAM_VERSION = packageDotJson.version;
export const USER_AGENT = `CrossSeed/${PROGRAM_VERSION}`;
export const TORRENT_TAG = "cross-seed";
export const TORRENT_CATEGORY_SUFFIX = `.cross-seed`;

export const EP_REGEX =
	/^(?<title>.+?)[_.\s-]+(?:(?<season>S\d+)?[_.\s-]{0,3}(?<episode>(?:E|(?<=S\d+[_.\s-]{1,3}))\d+(?:[\s-]?E?\d+)?(?![pix]))(?!\d+[pix])|(?<date>(?<year>(?:19|20)\d{2})[_.\s-](?<month>\d{2})[_.\s-](?<day>\d{2})))/i;
export const SEASON_REGEX =
	/^(?<title>.+?)[_.\s-]+(?<season>S\d+)(?:[_.\s~-]*?(?<seasonmax>S?\d+))?(?=[_.\s](?!E\d+))/i;
export const MOVIE_REGEX =
	/^(?<title>.+?)-?[_.\s][[(]?(?<year>(?:18|19|20)\d{2})[)\]]?(?![pix])/i;
export const ANIME_REGEX =
	/^(?:\[(?<group>.*?)\][_.\s-]?)?(?:\[?(?<title>.+?)[_.\s-]?(?:\(?(?:\d{1,2}(?:st|nd|rd|th))?\s?Season)?[_.\s-]?\]?)(?:[([~/|-]\s?(?!\d{4})(?<altTitle>.+?)[)\]~-]?\s?)?[_.\s-]?(?:\(?(?<year>(?:19|20)\d{2})\)?)?[[_.\s-](?:S\d{1,2})?[_.\s-]{0,3}(?:#|EP?|(?:SP))?[_.\s-]{0,3}(?<release>\d{1,4})(?:v\d)?[\])_.\s-]/i;
export const RELEASE_GROUP_REGEX =
	/(?<=-)(?:\W|\b)(?!(?:\d{3,4}[ip]))(?!\d+\b)(?:\W|\b)(?<group>[\w ]+?)(?:\[.+\])?(?:\))?(?=(?:\.\w{1,5})?$)/i;
export const RP_REGEX =
	/\b(?<type>(REPACK|PROPER)\d?)|(?<arrtype>(Proper)\d?)\b/;

export const VIDEO_EXTENSIONS = [".mkv", ".mp4", ".avi", ".ts"];

export const IGNORED_FOLDERS_REGEX =
	/^(S(eason )?\d{1,4}|((CD|DVD|DISC)\d{1,2}))$/i;

export const TORRENT_CACHE_FOLDER = "torrent_cache";

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
	SIZE_MISMATCH = "SIZE_MISMATCH",
	NO_DOWNLOAD_LINK = "NO_DOWNLOAD_LINK",
	DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
	RATE_LIMITED = "RATE_LIMITED",
	INFO_HASH_ALREADY_EXISTS = "INFO_HASH_ALREADY_EXISTS",
	FILE_TREE_MISMATCH = "FILE_TREE_MISMATCH",
	RELEASE_GROUP_MISMATCH = "RELEASE_GROUP_MISMATCH",
	BLOCKED_RELEASE = "BLOCKED_RELEASE",
	PROPER_REPACK_MISMATCH = "PROPER_REPACK_MISMATCH",
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
