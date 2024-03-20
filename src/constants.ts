import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

export const PROGRAM_NAME = packageDotJson.name;
export const PROGRAM_VERSION = packageDotJson.version;
export const USER_AGENT = `CrossSeed/${PROGRAM_VERSION}`;
export const TORRENT_TAG = "cross-seed";
export const TORRENT_CATEGORY_SUFFIX = `.cross-seed`;

export const EP_REGEX =
	/^(?<title>.+?)[_.\s-]+(?:(?<season>S\d+)?[_.\s]?(?<episode>E\d+(?:[\s-]?E?\d+)?(?![ip]))(?!\d+[ip])|(?<date>(?<year>\d{4})[_.\s-](?<month>\d{2})[_.\s-](?<day>\d{2})))/i;
export const SEASON_REGEX =
	/^(?<title>.+?)[_.\s-]+(?<season>S\d+)(?:[_.\s-]*?(?<seasonmax>S?\d+))?(?=[_.\s](?!E\d+))/i;
export const MOVIE_REGEX =
	/^(?<title>.+?)[_.\s][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;
export const RELEASE_GROUP_REGEX =
	/(?<=-)(?<group>[\w ]+)(?:\))?(?=(?:\.\w{1,5})?$)/i;

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
