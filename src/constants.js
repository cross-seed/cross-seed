const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?<episode>E\d+)/i;
const SEASON_REGEX = /^(?<title>.+)[. ](?<season>S\d+)(?:\s?-\s?(?<seasonmax>S?\d+))?(?!E\d+)/i;
const MOVIE_REGEX = /^(?<title>.+)[. ][[(]?(?<year>\d{4})[)\]]?(?![pi])/i;

const EXTENSIONS = ["mkv", "mp4", "avi"];

const CONFIG_TEMPLATE_URL =
	"https://github.com/mmgoodnow/cross-seed/blob/master/src/config.template.js";
const README_URL = "https://github.com/mmgoodnow/cross-seed";
const DAEMON_MODE_URL_HASH = "#daemon-mode-rtorrent-only-docker-recommended";

const ACTIONS = {
	SAVE: "SAVE",
	INJECT: "INJECT",
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

module.exports = {
	EP_REGEX,
	SEASON_REGEX,
	MOVIE_REGEX,
	EXTENSIONS,
	CONFIG_TEMPLATE_URL,
	README_URL,
	DAEMON_MODE_URL_HASH,
	ACTIONS,
};
