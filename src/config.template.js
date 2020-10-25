// All of the configuration can be overridden with command-line flags,
// and some are more useful as flags than permanent config (offset).
// If you find yourself always using the same command-line flag, you can set
// it here as a default.

module.exports = {
	configVersion: 1,

	jackettServerUrl: "http://localhost:9117/jackett",
	jackettApiKey: "YOUR_JACKETT_API_KEY_HERE",

	// Pause at least this much in between each Jackett search. Higher is safer.
	// It is not recommended to set this to less than 2 seconds.
	delay: 10,

	// Trackers to search
	// Set to [] if you want to search all trackers.
	// Tracker ids can be found in their Torznab feed paths
	trackers: ["oink", "tehconnection"],

	// directory containing torrent files.
	// For rtorrent, this is your session directory
	// as configured in your .rtorrent.rc file.
	// For deluge, this is ~/.config/deluge/state.
	torrentDir: "/path/to/torrent/file/dir",

	// where to put the torrent files that cross-seed finds for you.
	outputDir: ".",

	// Whether to search for single episode torrents
	includeEpisodes: false,

	// search for all torrents, regardless of their contents
	// this option overrides includeEpisodes.
	searchAll: false,
};
