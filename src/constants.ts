const packageDotJson = require("../package.json");

export const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
export const SEASON_REGEX =
	/^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
export const MOVIE_REGEX =
	/^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

export const VIDEO_EXTENSIONS = [".mkv", ".mp4", ".avi"];

export const DATA_EXTENSIONS = [".mkv", ".avi", ".mp4", ".ts", ".flac", ".mp3"];

export const TORRENT_CACHE_FOLDER = "torrent_cache";

export const USER_AGENT = `CrossSeed/${packageDotJson.version}`;

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
	SIZE_MISMATCH = "SIZE_MISMATCH",
	NO_DOWNLOAD_LINK = "NO_DOWNLOAD_LINK",
	DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
	RATE_LIMITED = "RATE_LIMITED",
	INFO_HASH_ALREADY_EXISTS = "INFO_HASH_ALREADY_EXISTS",
	FILE_TREE_MISMATCH = "FILE_TREE_MISMATCH",
}

export enum MatchMode {
	SAFE = "safe",
	RISKY = "risky",
}

export enum LinkType {
	SYMLINK = "symlink",
	HARDLINK = "hardlink",
}
