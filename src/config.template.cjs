// If you find yourself always using the same command-line flag, you can set
// it here as a default.

module.exports = {
	/**
	 * WARNING! WARNING! WARNING! WARNING! WARNING! WARNING! WARNING!
	 *
	 * THE NEXT 8 OPTIONS CONTAIN POTENTIALLY SENSITIVE INFORMATION
	 * THERE IS A NOTE WHERE YOU WILL WANT TO START COPYING FROM
	 * IF YOU ARE TRYING TO SHARE YOUR CONFIGURATION SETTINGS!
	 *
	 * WARNING! WARNING! WARNING! WARNING! WARNING! WARNING! WARNING!
	 **/

	/**
	 * List of Torznab URLs.
	 * For Jackett, click "Copy RSS feed"
	 * For Prowlarr, click on the indexer name and copy the Torznab Url, then append "?apikey=YOUR_PROWLARR_API_KEY"
	 * Wrap each URL in quotation marks, and separate them with commas, and surround the entire set in brackets.
	 */
	torznab: [],

	/**
	 * Bind to a specific host address.
	 * Example: "127.0.0.1"
	 * Default is "0.0.0.0"
	 */
	host: undefined,

	/**
	 * The port you wish to listen on for daemon mode.
	 */
	port: 2468,

	/**
	 * cross-seed will send POST requests to this url
	 * with a JSON payload of { title, body }.
	 * Conforms to the caronc/apprise REST API.
	 */
	notificationWebhookUrl: undefined,

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
	 * The url of your Deluge JSON-RPC interface.
	 * Usually ends with "/json".
	 * Only relevant with action: "inject".
	 * Supply your WebUI password as well
	 * "http://:password@localhost:8112/json"
	 */
	delugeRpcUrl: undefined,

	/**
	 * END OF POTENTIALLY SENSITIVE CONFIGURATION OPTIONS
	 */

	/**
	 * Pause at least this much in between each search. Higher is safer.
	 * It is not recommended to set this to less than 2 seconds.
	 */
	delay: 30,

	/**
	 * To search with downloaded data, you can pass in directories to your downloaded torrent
	 * data to find matches rather using the torrent files themselves for matching.
	 *
	 * If enabled, this needs to be surrounded by brackets. Windows users will need to use
	 * double backslash in all paths in this config.
	 *
	 * example:
	 * 		dataDirs: ["/path/here"],
	 * 		dataDirs: ["/path/here", "/other/path/here"],
	 * 		dataDirs: ["C:\\My Data\\Downloads"]
	 */
	dataDirs: [],

	/**
	 * Determines flexibility of naming during matching. "safe" will allow only perfect name/size matches
	 * using the standard matching algorithm. "risky" uses filesize as its only comparison point.
	 * Options: "safe", "risky"
	 */
	matchMode: "safe",

	/**
	 * Defines what category torrents injected by data-based matching should use.
	 * Default is "cross-seed-data"
	 */
	dataCategory: undefined,

	/**
	 * If this is specified, cross-seed will create links to matched files in the specified directory.
	 * It will create a different link for every changed file name or directory structure.
	 *
	 * Unlike dataDirs, this is just a quoted string WITHOUT []'s around it.
	 *
	 * IF YOU ARE USING HARDLINKS, THIS MUST BE UNDER THE SAME VOLUME AS YOUR DATADIRS
	 * THIS PATH MUST ALSO BE ACCESSIBLE VIA YOUR TORRENT CLIENT USING THE SAME PATH
	 */
	linkDir: undefined,

	/**
	 * cross-seed will use links of this type to inject data-based matches into your client.
	 * Options: "symlink", "hardlink"
	 */
	linkType: "hardlink",

	/**
	 * Enabling this will link files using v5's flat folder style. This option is necessary if
	 * you prefer flat folders of files or use qBittorrent and Automatic Torrent Management.
	 *
	 * Otherwise each individual Torznab tracker's cross-seeds will have it's own folder with
	 * the tracker's name and it's links within it.
	 *
	 * Default: false
	 */
	legacyLinking: false,

	/**
	 * Whether to skip recheck in Qbittorrent. If using "risky" matchMode it is HIGHLY
	 * recommended to set this to false.
	 * Only applies to data based matches.
	 */
	skipRecheck: true,

	/**
	 * Determines how deep into the specified dataDirs to go to generate new searchees.
	 * Setting this to higher values will result in more searchees and more API hits to
	 * your indexers.
	 */
	maxDataDepth: 1,

	/**
	 * Directory containing .torrent files.
	 * For qBittorrent, this is BT_Backup
	 * For rtorrent, this is your session directory
	 * 		as configured in your .rtorrent.rc file.
	 * For Deluge, this is ~/.config/deluge/state.
	 * For Transmission, this would be ~/.config/transmission/torrents
	 */
	torrentDir: "/path/to/torrent/file/dir",

	/**
	 * Where to save the torrent files that cross-seed finds for you.
	 */
	outputDir: ".",

	/**
	 * Whether to search for all episode torrents, including those from season packs.
	 * This option overrides includeSingleEpisodes.
	 */
	includeEpisodes: false,

	/**
	 * Whether to include single episode torrents in the search (not from season packs).
	 * Like `includeEpisodes` but slightly more restrictive.
	 */
	includeSingleEpisodes: false,

	/**
	 * Include torrents which contain non-video files
	 * This option does not override includeEpisodes or includeSingleEpisodes.
	 *
	 * If this option is set to false, any folders or torrents containing ANY non-video files
	 * will automatically be excluded from cross-seed searches.
	 *
	 * For example, if you have .srt or .nfo files inside your folders/torrents, you will this true.
	 * You may also want to set this as false to exclude things like music, games, or books.
	 *
	 * To search for everything except episodes, use (includeEpisodes: false, includeSingleEpisodes: false, includeNonVideos: true)
	 * To search for everything including episodes, use (includeEpisodes: true, includeNonVideos: true)
	 * To search for everything except season pack episodes (data-based)
	 *    use (includeEpisodes: false, includeSingleEpisodes: true, includeNonVideos: true)
	 */
	includeNonVideos: false,

	/**
	 * You should NOT modify this unless you have good reason.
	 * The following option is the preliminary value to compare sizes of releases
	 * for further comparison.
	 *
	 * decimal value (0.02 = 2%)
	 */
	fuzzySizeThreshold: 0.02,

	/**
	 * Exclude torrents first seen by cross-seed more than this long ago.
	 * Format: https://github.com/vercel/ms
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 * "0" - this will search everything exactly once, never more.
	 */
	excludeOlder: "2 weeks",

	/**
	 * Exclude torrents which have been searched
	 * more recently than this long ago.
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	excludeRecentSearch: "3 days",

	/**
	 * What action to take upon a match being found
	 * Options: "save", "inject"
	 */
	action: "inject",

	/**
	 * qBittorrent and Deluge specific
	 * Whether to inject using the same labels/categories as the original torrent.
	 * qBittorrent: This will apply the category's save path
	 * Example: if you have a label/category called "Movies",
	 * this will automatically inject cross-seeds to "Movies.cross-seed"
	 */
	duplicateCategories: false,

	/**
	 * Run rss scans on a schedule. Format: https://github.com/vercel/ms
	 * Set to undefined or null to disable. Minimum of 10 minutes.
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	rssCadence: "30 minutes",

	/**
	 * Run searches on a schedule. Format: https://github.com/vercel/ms
	 * Set to undefined or null to disable. Minimum of 1 day.
	 * If you have RSS enabled, you won't need this to run often (2+ weeks recommended)
	 * Examples:
	 * "10min"
	 * "2w"
	 * "3 days"
	 */
	searchCadence: "1 day",

	/**
	 * Fail snatch requests that haven't responded after this long.
	 * Set to null for an infinite timeout.
	 * Format: https://github.com/vercel/ms
	 * Examples:
	 * "30sec"
	 * "10s"
	 * "1min"
	 * null
	 */
	snatchTimeout: undefined,

	/**
	 * Fail search requests that haven't responded after this long.
	 * Set to null for an infinite timeout.
	 * Format: https://github.com/vercel/ms
	 * Examples:
	 * "30sec"
	 * "10s"
	 * "1min"
	 * null
	 */
	searchTimeout: undefined,

	/**
	 * The number of searches to be done before it stops.
	 * Combine this with "excludeRecentSearch" and "searchCadence" to smooth long-term API usage patterns.
	 * Set to null for no limit.
	 */
	searchLimit: 100,

	/**
	 * The list of infohashes or strings which are contained in torrents name that you want to be excluded from cross-seed
	 * This is the same format as torznab, surround the entire set of quoted strings in square brackets
	 * Leave as undefined to disable
	 *
	 * example:
	 * blockList: ["-excludedGroup", "-excludedGroup2", "x265", "3317e6485454354751555555366a8308c1e92093"],
	 */
	blockList: undefined,

	/**
	 * Provide your own API key here to override the autogenerated one.
	 * Not recommended - prefer using the autogenerated API key via `cross-seed api-key`
	 * Must be 24+ characters
	 */
	apiKey: undefined,
};
