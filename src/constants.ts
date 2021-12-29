export const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
export const SEASON_REGEX =
	/^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
export const MOVIE_REGEX =
	/^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

export const EXTENSIONS = ["mkv", "mp4", "avi"];

export const CONFIG_TEMPLATE_URL =
	"https://github.com/mmgoodnow/cross-seed/blob/master/src/config.template.js";

export const TORRENT_CACHE_FOLDER = "torrent_cache";

export enum Action {
	SAVE = "save",
	INJECT = "inject",
}

export enum InjectionResult {
	SUCCESS,
	FAILURE,
	ALREADY_EXISTS,
	TORRENT_NOT_COMPLETE,
}

export enum Decision {
	MATCH = "MATCH",
	SIZE_MISMATCH = "SIZE_MISMATCH",
	NO_DOWNLOAD_LINK = "NO_DOWNLOAD_LINK",
	DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
	INFO_HASH_ALREADY_EXISTS = "INFO_HASH_ALREADY_EXISTS",
	FILE_TREE_MISMATCH = "FILE_TREE_MISMATCH",
}

export const PermanentDecisions: Decision[] = [
	Decision.SIZE_MISMATCH,
	Decision.NO_DOWNLOAD_LINK,
	Decision.FILE_TREE_MISMATCH,
];
