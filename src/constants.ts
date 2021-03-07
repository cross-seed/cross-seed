export const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
export const SEASON_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
export const MOVIE_REGEX = /^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

export const EXTENSIONS = ["mkv", "mp4", "avi"];

export const CONFIG_TEMPLATE_URL =
	"https://github.com/mmgoodnow/cross-seed/blob/master/src/config.template.js";

export const ACTIONS = {
	SAVE: "save",
	INJECT: "inject",
};

// because I'm sick of intellij whining at me
const _result = {
	Link: undefined,
	TrackerId: undefined,
	Results: undefined,
	Title: undefined,
	Size: undefined,
	Guid: undefined,
};

export enum InjectionResult {
	SUCCESS = 1,
	FAILURE = -1,
	ALREADY_EXISTS = 0,
}
