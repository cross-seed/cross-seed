const axios = require("axios");
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
	return axios.get(`${jackettServerUrl}${jackettPath}`, { params });
}

module.exports = { makeJackettRequest };
