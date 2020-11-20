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

async function withTempConfigOptions(tempOptions, func) {
	const ogRuntimeConfig = runtimeConfig;
	setRuntimeConfig({ ...ogRuntimeConfig, ...tempOptions });
	const ret = await func();
	setRuntimeConfig(ogRuntimeConfig);
	return ret;
}

module.exports = { getRuntimeConfig, setRuntimeConfig, withTempConfigOptions };
