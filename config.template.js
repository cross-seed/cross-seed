module.exports = {
	jackettServerUrl: "http://localhost:9117/jackett",
	jackettApiKey: "YOUR_JACKETT_API_KEY_HERE",

	// Pause at least this much in between each Jackett search. Higher is safer.
	// It is not recommended to set this to less than 2 seconds.
	delayMs: 10 * 1000,

	// Tracker to search. As of right now, can be one of:
	// - the string "all"
	// - a single tracker id as found in its Torznab feed
	//   e.g. "oink"
	trackers: "all",

	// directory containing torrent files.
	// For rtorrent, this is your session directory
	// as configured in your .rtorrent.rc file.
	// For deluge, this is ~/.config/deluge/state.
	torrentDir: "/path/to/torrent/file/dir",
};
