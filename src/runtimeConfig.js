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
};

function setRuntimeConfig(configObj) {
	runtimeConfig = configObj;
}

function getRuntimeConfig() {
	return runtimeConfig;
}

module.exports = { getRuntimeConfig, setRuntimeConfig };
