exports.EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
exports.SEASON_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
exports.MOVIE_REGEX = /^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

exports.EXTENSIONS = ["mkv", "mp4", "avi"];

exports.CONFIG_TEMPLATE_URL =
	"https://github.com/mmgoodnow/cross-seed/blob/master/src/config.template.js";

exports.ACTIONS = {
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
