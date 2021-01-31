let runtimeConfig = {
	jackettServerUrl: undefined,
	jackettApiKey: undefined,
	delay: undefined,
	trackers: undefined,
	torrentDir: undefined,
	outputDir: undefined,
	includeEpisodes: undefined,
	verbose: undefined,
	searchAll: undefined,
	excludeOlder: undefined,
	excludeRecentSearch: undefined,
	action: undefined,
	rtorrentRpcUrl: undefined,
};

function setRuntimeConfig(configObj) {
	runtimeConfig = configObj;
}

function getRuntimeConfig() {
	return runtimeConfig;
}

exports.setRuntimeConfig = setRuntimeConfig;
exports.getRuntimeConfig = getRuntimeConfig;
