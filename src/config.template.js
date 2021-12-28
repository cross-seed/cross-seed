// If you find yourself always using the same command-line flag, you can set
// it here as a default.

export default {
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
