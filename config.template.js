"use strict";

// All of the configuration can be overridden with command-line flags,
// and some are more useful as flags than permanent config (offset).
// If you find yourself always using the same command-line flag, you can set
// it here as a default.

module.exports = {
	jackettServerUrl: "http://localhost:9117/jackett",
	jackettApiKey: "YOUR_JACKETT_API_KEY_HERE",

	// Pause at least this much in between each Jackett search. Higher is safer.
	// It is not recommended to set this to less than 2 seconds.
	delay: 10,

	// Tracker to search. As of right now, can be one of:
	// - the string "all"
	// - a single tracker id as found in its Torznab feed
	//   e.g. "oink"
	tracker: "all",

	// directory containing torrent files.
	// For rtorrent, this is your session directory
	// as configured in your .rtorrent.rc file.
	// For deluge, this is ~/.config/deluge/state.
	torrentDir: "/path/to/torrent/file/dir",

	// where to put the torrent files that cross-seed finds for you.
	outputDir: ".",

	// Lets you start searching from the middle of the list if you experience
	// a failure.
	offset: 0,
};
