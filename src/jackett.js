const querystring = require("querystring");
const axios = require("axios");

function makeJackettRequest(query, config) {
	const { jackettApiKey, trackers, jackettServerUrl } = config;
	const jackettPath = `/api/v2.0/indexers/all/results`;
	const params = querystring.stringify({
		apikey: jackettApiKey,
		Query: query,
		Tracker: trackers,
	});
	return axios.get(`${jackettServerUrl}${jackettPath}?${params}`);
}

module.exports = { makeJackettRequest };
