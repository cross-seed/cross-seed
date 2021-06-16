import querystring from "querystring";
import get from "simple-get";
import { EP_REGEX, MOVIE_REGEX, SEASON_REGEX } from "./constants";
import { CrossSeedError } from "./errors";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";

export interface JackettResult {
	Author: unknown;
	BlackholeLink: string;
	BookTitle: unknown;
	Category: number[];
	CategoryDesc: string;
	Description: unknown;
	Details: string;
	DownloadVolumeFactor: number;
	Files: number;
	FirstSeen: string;
	Gain: number;
	Grabs: number;
	Guid: string;
	Imdb: unknown;
	InfoHash: unknown;
	Link: string;
	MagnetUri: unknown;
	MinimumRatio: number;
	MinimumSeedTime: number;
	Peers: number;
	Poster: unknown;
	PublishDate: string;
	RageID: unknown;
	Seeders: number;
	Size: number;
	TMDb: unknown;
	TVDBId: unknown;
	Title: string;
	Tracker: string;
	TrackerId: string;
	UploadVolumeFactor: number;
}

export interface JackettIndexer {
	ID: string;
	Name: string;
	Status: number;
	Results: number;
	Error: string;
}

export interface JackettResponse {
	Results: JackettResult[];
	Indexers: JackettIndexer[];
}

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
