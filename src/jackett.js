const get = require("simple-get");
const querystring = require("querystring");
const chalk = require("chalk");
const { getRuntimeConfig } = require("./runtimeConfig");
const { SEASON_REGEX, MOVIE_REGEX, EP_REGEX } = require("./constants");
const logger = require("./logger");

function reformatTitleForSearching(name) {
	const seasonMatch = name.match(SEASON_REGEX);
	const movieMatch = name.match(MOVIE_REGEX);
	const episodeMatch = name.match(EP_REGEX);
	const fullMatch = episodeMatch
		? episodeMatch[0]
		: seasonMatch
		? seasonMatch[0]
		: movieMatch
		? movieMatch[0]
		: name;
	return fullMatch.replace(/[.()[\]]/g, " ").replace(/\s+/g, " ");
}

function fullJackettUrl(jackettServerUrl, params) {
	const jackettPath = `/api/v2.0/indexers/all/results`;
	return `${jackettServerUrl}${jackettPath}?${querystring.encode(params)}`;
}

async function validateJackettApi() {
	const { jackettServerUrl, jackettApiKey: apikey } = getRuntimeConfig();

	if (/\/$/.test(jackettServerUrl)) {
		const msg = "Warning: Jackett server url should not end with '/'";
		logger.error(chalk.yellow(msg));
	}

	// search for gibberish so the results will be empty
	const gibberish = "bscdjpstabgdspjdasmomdsenqciadsnocdpsikncaodsnimcdqsanc";
	try {
		await makeJackettRequest(gibberish);
	} catch (e) {
		const dummyUrl = fullJackettUrl(jackettServerUrl, { apikey });
		logger.error(chalk.red`Could not reach Jackett at the following URL:`);
		logger.error(dummyUrl);
		throw e;
	}
}

function makeJackettRequest(name) {
	const { jackettApiKey, trackers, jackettServerUrl } = getRuntimeConfig();
	const params = {
		apikey: jackettApiKey,
		Query: reformatTitleForSearching(name),
		"Tracker[]": trackers,
	};

	const opts = {
		method: "GET",
		url: fullJackettUrl(jackettServerUrl, params),
		json: true,
	};

	logger.verbose(`[jackett] search query is "${params.Query}"`);

	return new Promise((resolve, reject) => {
		get.concat(opts, (err, res, data) => {
			if (err) reject(err);
			resolve({ ...res, data });
		});
	});
}

module.exports = { makeJackettRequest, validateJackettApi };
