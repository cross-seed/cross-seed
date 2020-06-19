const get = require("simple-get");
const querystring = require("querystring");
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

function makeJackettRequest(name, config) {
	const { jackettApiKey, trackers, jackettServerUrl } = config;
	const jackettPath = `/api/v2.0/indexers/all/results`;
	const params = {
		apikey: jackettApiKey,
		Query: reformatTitleForSearching(name),
		Tracker: trackers,
	};
	
	const opts = {
		method: "GET",
		url: `${jackettServerUrl}${jackettPath}?${querystring.encode(params)}`,
		json: true,
	};

	return new Promise((resolve, reject) => {
		get.concat(opts, (err, res, data) => {
			if (err) reject(err);
			resolve({ ...res, data });
		});
	});
}

module.exports = { makeJackettRequest };
