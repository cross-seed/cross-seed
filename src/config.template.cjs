// If you find yourself always using the same command-line flag, you can set it
// here as a default.

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
	 * For Jackett, click "Copy RSS feed".
	 * For Prowlarr, click on the indexer name and copy the Torznab Url, then
	 * append "?apikey=YOUR_PROWLARR_API_KEY". Wrap each URL in quotation marks
	 * and separate them with commas, and surround the entire set in brackets.
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
	 * cross-seed will send POST requests to this url with a JSON payload of
	 * { title, body }. Conforms to the caronc/apprise REST API.
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
	 * Supply your WebUI password as well like so:
	 * "http://:password@localhost:8112/json"
	 */
	delugeRpcUrl: undefined,

	/**
	 * END OF POTENTIALLY SENSITIVE CONFIGURATION OPTIONS
	 */

	/**
	 * Pause at least this many seconds in between each search. Higher is safer
	 * for you and friendlier for trackers.
	 * Minimum value of 10.
	 */
	delay: 30,

	/**
	 * To search with already downloaded data, you can enter in the directories
	 * to your downloaded torrent data to find matches, rather than relying
	 * entirely on the .torrent files themselves for matching.
	 *
	 * If directories are entered, they must all be on the one line and they
	 * need to be surrounded by brackets.
	 * Windows users will need to use double backslash in all paths in this
	 * config.
	 *
	 * example:
	 *     dataDirs: ["/downloads/movies", "/downloads/packs"],
	 * or for windows users
	 *     dataDirs: ["C:\\My Data\\Downloads\\Movies"],
	 */
	dataDirs: [],

	/**
	 * Determines flexibility of naming during matching.
	 * "safe" will allow only perfect name/size matches using the standard
	 * matching algorithm.
	 * "risky" uses filesize as its only comparison point.
	 * Options: "safe", "risky".
	 */
	matchMode: "safe",

	/**
	 * Defines what category torrents injected by data-based matching should
	 * use.
	 * Default is "cross-seed-data".
	 */
	dataCategory: undefined,

	/**
	 * If this is specified, cross-seed will create links to matched files in
	 * the specified directory.
	 * It will create a different link for every changed file name or directory
	 * structure.
	 *
	 * Unlike dataDirs, this is just a quoted string WITHOUT []'s around it.
	 *
	 * IF YOU ARE USING HARDLINKS, THIS MUST BE UNDER THE SAME VOLUME AS YOUR
	 * DATADIRS. THIS PATH MUST ALSO BE ACCESSIBLE VIA YOUR TORRENT CLIENT
	 * USING THE SAME PATH.
	 */
	linkDir: undefined,

	/**
	 * cross-seed will use links of this type to inject data-based matches into
	 * your client.
	 * https://www.cross-seed.org/docs/basics/faq-troubleshooting#what-linktype-should-i-use
	 * Options: "symlink", "hardlink".
	 */
	linkType: "hardlink",

	/**
	 * Enabling this will link files using v5's flat folder style. This option
	 * is necessary if you prefer flat folders of files or use qBittorrent and
	 * Automatic Torrent Management.
	 *
	 * Otherwise each individual Torznab tracker's cross-seeds will have it's
	 * own folder with the tracker's name and it's links within it.
	 *
	 * Default: false.
	 */
	legacyLinking: false,

	/**
	 * Whether to skip recheck in qBittorrent or Deluge. Not supported in rTorrent/Transmission.
	 */
	skipRecheck: true,

	/**
	 * Determines how deep into the specified dataDirs to go to generate new
	 * searchees. Setting this to higher values will result in more searchees
	 * and more API hits to your indexers.
	 */
	maxDataDepth: 1,

	/**
	 * Directory containing .torrent files.
	 * For qBittorrent, this is BT_Backup.
	 * For rtorrent, this is your session directory as configured in your
	 * .rtorrent.rc file.
	 * For Deluge, this is ~/.config/deluge/state.
	 * For Transmission, this would be ~/.config/transmission/torrents.
	 */
	torrentDir: "/path/to/torrent/file/dir",

	/**
	 * Where to save the torrent files that cross-seed finds for you.
	 */
	outputDir: ".",

	/**
	 * Whether to search for all episode torrents, including those from season
	 * packs.
	 * This option overrides includeSingleEpisodes.
	 */
	includeEpisodes: false,

	/**
	 * Whether to include single episode torrents in the search (not those from
	 * season packs).
	 * Like `includeEpisodes` but slightly more restrictive.
	 */
	includeSingleEpisodes: false,

	/**
	 * Include torrents which contain non-video files.
	 * This option does not override includeEpisodes or includeSingleEpisodes.
	 *
	 * If this option is set to false, any folders or torrents containing ANY
	 * non-video files will automatically be excluded from cross-seed searches.
	 *
	 * For example, if you have .srt or .nfo files inside your folders/torrents
	 * you would set this as true.
	 * For full disc based folders (not .ISO) you may wish to set this as true.
	 * You may also want to set this as false to exclude things like music,
	 * games, or books.
	 *
	 * To search for everything except episodes, use:
	 *
	 *		includeEpisodes: false
	 *		includeSingleEpisodes: false
	 *		includeNonVideos: true
	 *
	 * To search for everything including episodes, use:
	 *
	 *		includeEpisodes: true
	 *		includeNonVideos: true
	 *
	 * To search for everything except season pack episodes (data-based) use:
	 *
	 *		includeEpisodes: false
	 *		includeSingleEpisodes: true
	 *		includeNonVideos: true
	 *
	 */
	includeNonVideos: false,

	/**
	 * You should NOT modify this unless you have good reason.
	 * The following option is the preliminary value to compare sizes of
	 * releases for further comparison.
	 *
	 * decimal value (0.02 = 2%)
	 */
	fuzzySizeThreshold: 0.02,

	/**
	 * Time based options below use the following format:
	 * https://github.com/vercel/ms
	 */

	/**
	 * Exclude torrents first seen by cross-seed more than this long ago.
	 * Examples:
	 * "10 minutes"
	 * "1 day"
	 * "0" - this will search everything exactly once, never more.
	 */
	excludeOlder: "2 weeks",

	/**
	 * Exclude torrents which have been searched more recently than this long
	 * ago.
	 * Doesn't exclude previously failed searches.
	 * Examples:
	 * "2 days"
	 * "1 year"
	 */
	excludeRecentSearch: "3 days",

	/**
	 * What action to take upon a match being found.
	 * Options: "save", "inject".
	 */
	action: "inject",

	/**
	 * qBittorrent and Deluge specific.
	 * Whether to inject using the same labels/categories as the original
	 * torrent.
	 * qBittorrent: This will apply the category's save path.
	 * Example: if you have a label/category called "Movies", this will
	 * automatically inject cross-seeds to "Movies.cross-seed".
	 */
	duplicateCategories: false,

	/**
	 * Run rss scans on a schedule.
	 * Set to undefined or null to disable. Minimum of 10 minutes.
	 * Examples:
	 * "10 minutes"
	 * "1 hour"
	 */
	rssCadence: "30 minutes",

	/**
	 * Run searches on a schedule.
	 * Set to undefined or null to disable. Minimum of 1 day.
	 * Examples:
	 * "2 weeks"
	 * "3 days"
	 */
	searchCadence: "1 day",

	/**
	 * Fail snatch requests that haven't responded after this long.
	 * Set to null for an infinite timeout.
	 * Examples:
	 * "30 seconds"
	 * null
	 */
	snatchTimeout: undefined,

	/**
	 * Fail search requests that haven't responded after this long.
	 * Set to null for an infinite timeout.
	 * Examples:
	 * "30 seconds"
	 * null
	 */
	searchTimeout: undefined,

	/**
	 * The number of searches to make in one run/batch.
	 * If more than this many searches are queued,
	 * "searchCadence" will determine how long until the next batch.
	 *
	 * Combine this with "excludeRecentSearch" and "searchCadence" to smooth
	 * long-term API usage patterns.
	 *
	 * Set to null for no limit.
	 */
	searchLimit: 100,

	/**
	 * The list of infohashes or strings which are contained in torrents that
	 * you want to be excluded from cross-seed. This is the same format as
	 * torznab, surround the entire set of quoted strings in square brackets
	 * You can use any combination which must be entered on the one line.
	 * Leave as undefined to disable.
	 *
	 * examples:
	 *
	 *		blockList: ["-excludedGroup", "-excludedGroup2"],
	 *		blocklist: ["x265"],
	 *		blocklist: ["Release.Name"],
	 *		blocklist: ["3317e6485454354751555555366a8308c1e92093"],
	 */
	blockList: undefined,

	/**
	 * Provide your own API key here to override the autogenerated one.
	 * Not recommended - prefer using the autogenerated API key via
	 * `cross-seed api-key`.
	 * Must be 24+ characters.
	 */
	apiKey: undefined,
};
