export const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
export const SEASON_REGEX =
	/^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
export const MOVIE_REGEX =
	/^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

export const EXTENSIONS = ["mkv", "mp4", "avi"];

export const DATA_EXTENSIONS = [".mkv", ".avi", ".mp4", ".ts", ".flac", ".mp3"];

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
export enum RenameResult {
	SUCCESS = "SUCESS",
	FAILURE = "FAILURE",
}

export enum SaveResult {
	SAVED = "SAVED",
}

export type ActionResult = InjectionResult | SaveResult;

export enum Decision {
	MATCH = "MATCH",
	MATCH_EXCEPT_PARENT_DIR = "MATCH_EXCEPT_PARENT_DIR",
	SIZE_MISMATCH = "SIZE_MISMATCH",
	NO_DOWNLOAD_LINK = "NO_DOWNLOAD_LINK",
	DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
	INFO_HASH_ALREADY_EXISTS = "INFO_HASH_ALREADY_EXISTS",
	FILE_TREE_MISMATCH = "FILE_TREE_MISMATCH",
}
