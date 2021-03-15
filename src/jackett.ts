import get from "simple-get";
import querystring from "querystring";
import { getRuntimeConfig } from "./runtimeConfig";
import { SEASON_REGEX, MOVIE_REGEX, EP_REGEX } from "./constants";
import * as logger from "./logger";
import { CrossSeedError } from "./errors";
import { JackettResponse, JackettResult } from "./types";

function reformatTitleForSearching(name: string): string {
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
	return fullMatch
		.replace(/[.()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function fullJackettUrl(jackettServerUrl: string, params) {
	const jackettPath = `/api/v2.0/indexers/all/results`;
	return `${jackettServerUrl}${jackettPath}?${querystring.encode(params)}`;
}

export async function validateJackettApi(): Promise<void> {
	const { jackettServerUrl, jackettApiKey: apikey } = getRuntimeConfig();

	if (/\/$/.test(jackettServerUrl)) {
		const msg = "Warning: Jackett server url should not end with '/'";
		logger.warn(msg);
	}

	// search for gibberish so the results will be empty
	const gibberish = "bscdjpstabgdspjdasmomdsenqciadsnocdpsikncaodsnimcdqsanc";
	try {
		await makeJackettRequest(gibberish);
	} catch (e) {
		const dummyUrl = fullJackettUrl(jackettServerUrl, { apikey });
		throw new CrossSeedError(`Could not reach Jackett at ${dummyUrl}`);
	}
}

export function makeJackettRequest(name: string): Promise<JackettResponse> {
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

	logger.verbose(`[jackett] making search with query "${params.Query}"`);

	return new Promise((resolve, reject) => {
		get.concat(opts, (err, res, data) => {
			if (err) reject(err);
			else resolve(data);
		});
	});
}
