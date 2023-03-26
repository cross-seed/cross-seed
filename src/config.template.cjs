// If you find yourself always using the same command-line flag, you can set
// it here as a default.

module.exports = {
	/**
	 * Pause at least this much in between each search. Higher is safer.
	 * 	It is not recommended to set this to less than 2 seconds.
	 */
	delay: 10,
	/**
	 * List of Torznab urls.
	 * The path should end in /api
	 * For Jackett, click "Copy RSS feed"
	 * For Prowlarr, click (i) and copy the Torznab Url, then append "?apikey=YOUR_PROWLARR_API_KEY"
	 */
	torznab: [],

	/**
	 * To search with downloaded data, you can pass in directories to your downloaded torrent data
	 * to find matches rather using the torrent files themselves for matching.
	 */
	dataDirs: [],

	/**
	 * Determines flexibility of naming during matching. "safe" will allow only perfect name matches
	 * using the standard matching algorithm. "risky" uses filesize as its only comparison point.
	 * Options: "safe", "risky"
	 */
	matchMode: "safe",

	/**
	 * Defines what category torrents injected by data-based matching should use. Default is
	 * cross-seed-data
	 */
	dataCategory: undefined,

	/**
	 * If this is specified, cross-seed will create links to scanned files in the specified directory.
	 * It will create a different link for every changed file name or directory structure.
	 */
	linkDir: undefined,

	/**
	 * cross-seed will use links of this type to inject data-based matches into your client.
	 * Only relevant if dataDirs is specified.
	 * Options: "symlink", "hardlink"
	 */
	linkType: "symlink",

	/**
	 * Whether to skip recheck in Qbittorrent. If using "risky" matchMode it is HIGHLY
	 * recommended to set this to false.
	 */
	skipRecheck: false,

	/**
	 * Determines how deep into the specified dataDirs to go to generate new searchees.
	 * Setting this to higher values will result in more searchees and more API hits to
	 * your indexers.
	 */
	maxDataDepth: 2,

	/**
	 * directory containing torrent files.
	 * For rtorrent, this is your session directory
	 * as configured in your .rtorrent.rc file.
	 * For deluge, this is ~/.config/deluge/state.
	 */
	torrentDir: "/path/to/torrent/file/dir",

	/**
	 * where to put the torrent files that cross-seed finds for you.
	 */
	outputDir: ".",

	/**
	 * Whether to search for single episode torrents
	 */
	includeEpisodes: false,

	/**
	 * Include torrents which contain non-video files
	 * This option does not override includeEpisodes.
	 * To search for everything except episodes, use (includeEpisodes: false, includeNonVideos: true)
	 * To search for everything including episodes, use (includeEpisodes: true, includeNonVideos: true)
	 */
	includeNonVideos: false,

	/**
	 * fuzzy size match threshold
	 * decimal value (0.02 = 2%)
	 */
	fuzzySizeThreshold: 0.02,

	/**
	 * Exclude torrents first seen more than this long ago.
	 * Format: https://github.com/vercel/ms
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	excludeOlder: undefined,

	/**
	 * Exclude torrents which have been searched
	 * more recently than this long ago.
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	excludeRecentSearch: undefined,

	/**
	 * can be either "save" or "inject".
	 * With "inject" you need to set up one of the below clients.
	 */
	action: "save",

	/**
	 * The url of your rtorrent XMLRPC interface.
	 * Only relevant with action: "inject".
	 * Could be something like "http://username:password@localhost:1234/RPC2
	 */
	rtorrentRpcUrl: undefined,

	/**
	 * The url of your qBittorrent webui.
	 * Only relevant with action: "inject".
	 * Supply your username and password inside the url like so:
	 * "http://username:password@localhost:8080"
	 */
	qbittorrentUrl: undefined,

	/**
	 * The url of your Transmission RPC interface.
	 * Usually ends with "/transmission/rpc".
	 * Only relevant with action: "inject".
	 * Supply your username and password inside the url like so:
	 * "http://username:password@localhost:9091/transmission/rpc"
	 */
	transmissionRpcUrl: undefined,

	/**
	 * qBittorrent-specific
	 * Whether to inject using categories with the same save paths as your normal categories.
	 * Example: if you have a category called "Movies",
	 * this will automatically inject cross-seeds to "Movies.cross-seed"
	 */
	duplicateCategories: false,

	/**
	 * cross-seed will send POST requests to this url
	 * with a JSON payload of { title, body }.
	 * Conforms to the caronc/apprise REST API.
	 */
	notificationWebhookUrl: undefined,

	/**
	 * Listen on a custom port.
	 */
	port: 2468,

	/**
	 * Bind to a specific host address.
	 * Example: "127.0.0.1"
	 */
	host: undefined,

	/**
	 * Run rss scans on a schedule. Format: https://github.com/vercel/ms
	 * Set to undefined or null to disable. Minimum of 10 minutes.
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	rssCadence: undefined,

	/**
	 * Run searches on a schedule. Format: https://github.com/vercel/ms
	 * Set to undefined or null to disable. Minimum of 1 day.
	 * If you have RSS enabled, you won't need this to run often (2+ weeks recommended)
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	searchCadence: undefined,
};
