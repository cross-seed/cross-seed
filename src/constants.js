const EP_REGEX = /^(?<title>.+)[. ](?<season>S\d\d)(?<episode>E\d\d)/i;
const SEASON_REGEX = /^(?<title>.+)[. ](?<season>S\d\d)(?!E\d\d)/i;
const MOVIE_REGEX = /^(?<title>.+)[. ](?<year>\d{4})/i;

const EXTENSIONS = ["mkv", "mp4", "avi"];

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
};
