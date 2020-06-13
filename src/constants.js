const EP_REGEX = /S\d\dE\d\d/i;
const SEASON_REGEX = /^(.+)[. ](S\d\d)(?!E\d\d)/i;

// because I'm sick of intellij whining at me
const result = {
	Link: undefined,
	TrackerId: undefined,
	Results: undefined,
	Title: undefined,
}

module.exports = { EP_REGEX, SEASON_REGEX };
