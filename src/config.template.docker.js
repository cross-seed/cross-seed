// All of the configuration can be overridden with command-line flags,
// and some are more useful as flags than permanent config (offset).
// If you find yourself always using the same command-line flag, you can set
// it here as a default.

module.exports = {
	jackettServerUrl: "http://jackett:9117/jackett",
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
	// Don't change this for Docker.
	// Instead set the volume mapping on your docker container.
	torrentDir: "/torrents",

	// where to put the torrent files that cross-seed finds for you.
	// Don't change this for Docker.
	// Instead set the volume mapping on your docker container.
	outputDir: "/cross-seeds",

	// Whether to search for single episode torrents
	includeEpisodes: false,

	// search for all torrents, regardless of their contents
	// this option overrides includeEpisodes.
	searchAll: false,

	// Exclude torrents first seen more than n minutes ago.
	excludeOlder: undefined,

	// Exclude torrents which have been searched
	// more recently than n minutes ago.
	excludeRecentSearch: undefined,

	// can be either "save" or "inject".
	// With "inject" you need to set up one of the below clients.
	action: "save",

	// The url of your rtorrent XMLRPC interface.
	// Only relevant with action: "inject".
	// Could be something like "http://username:password@localhost:1234/RPC2
	rtorrentRpcUrl: undefined,

	// The url of your qBittorrent webui.
	// Only relevant with action: "inject".
	// Supply your username and password inside the url like so:
	// "http://username:password@localhost:8080"
	qbittorrentUrl: undefined,

	// cross-seed will send POST requests to this url
	// with a JSON payload of { title, body }.
	// Conforms to the caronc/apprise REST API.
	notificationWebhookUrl: undefined,
};
