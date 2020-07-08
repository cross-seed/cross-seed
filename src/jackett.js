const get = require("simple-get");
const querystring = require("querystring");
const chalk = require("chalk");
const { SEASON_REGEX, MOVIE_REGEX, EP_REGEX } = require("./constants");

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
	return fullMatch.replace(".", " ");
}

function fullJackettUrl(jackettServerUrl, params) {
	const jackettPath = `/api/v2.0/indexers/all/results`;
	return `${jackettServerUrl}${jackettPath}?${querystring.encode(params)}`;
}

async function validateJackettApi(config) {
	const { jackettServerUrl, jackettApiKey: apikey } = config;

	if (/\/$/.test(jackettServerUrl)) {
		const msg = "Warning: Jackett server url should not end with '/'";
		console.error(chalk.yellow(msg));
	}

	// search for gibberish so the results will be empty
	const gibberish = "bscdjpstabgdspjdasmomdsenqciadsnocdpsikncaodsnimcdqsanc";
	try {
		await makeJackettRequest(gibberish, config);
	} catch (e) {
		const dummyUrl = fullJackettUrl(jackettServerUrl, { apikey });
		console.error(chalk.red`Could not reach Jackett at the following URL:`);
		console.error(dummyUrl);
		throw e;
	}
}

function makeJackettRequest(name, config) {
	const { jackettApiKey, trackers, jackettServerUrl } = config;
	const params = {
		apikey: jackettApiKey,
		Query: reformatTitleForSearching(name),
		["Tracker[]"]: trackers,
	};

	const opts = {
		method: "GET",
		url: fullJackettUrl(jackettServerUrl, params),
		json: true,
	};

	return new Promise((resolve, reject) => {
		get.concat(opts, (err, res, data) => {
			if (err) reject(err);
			resolve({ ...res, data });
		});
	});
}

module.exports = { makeJackettRequest, validateJackettApi };
