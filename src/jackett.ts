import querystring from "querystring";
import get from "simple-get";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { SearchResult } from "./pipeline.js";
import {
	EmptyNonceOptions,
	getRuntimeConfig,
	NonceOptions,
} from "./runtimeConfig.js";
import { reformatTitleForSearching } from "./utils.js";

export interface OgJackettResult {
	Guid: string;
	Link: string;
	Size: number;
	Title: string;
	TrackerId: string;
}

export interface JackettResponse {
	Results: OgJackettResult[];
}

function fullJackettUrl(
	jackettServerUrl: string,
	params: Record<string, string | string[]>
) {
	const jackettPath = `/api/v2.0/indexers/all/results`;
	return `${jackettServerUrl}${jackettPath}?${querystring.encode(params)}`;
}

export async function validateJackettApi(): Promise<void> {
	const { jackettServerUrl, jackettApiKey: apikey } = getRuntimeConfig();

	if (/\/$/.test(jackettServerUrl)) {
		logger.warn("Warning: Jackett server url should not end with '/'");
	}

	// search for gibberish so the results will be empty
	const gibberish = "bscdjpstabgdspjdasmomdsenqciadsnocdpsikncaodsnimcdqsanc";
	try {
		await searchJackett(gibberish);
	} catch (e) {
		const dummyUrl = fullJackettUrl(jackettServerUrl, { apikey });
		throw new CrossSeedError(`Could not reach Jackett at ${dummyUrl}`);
	}
}

function parseResponse(response: JackettResponse): SearchResult[] {
	return response.Results.map((result) => ({
		guid: result.Guid,
		link: result.Link,
		size: result.Size,
		title: result.Title,
		tracker: result.TrackerId,
	}));
}

export function searchJackett(
	name: string,
	nonceOptions: NonceOptions = EmptyNonceOptions
): Promise<SearchResult[]> {
	const {
		jackettApiKey,
		trackers: runtimeConfigTrackers,
		jackettServerUrl,
	} = getRuntimeConfig();
	const { trackers = runtimeConfigTrackers } = nonceOptions;
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

	logger.verbose({
		label: Label.JACKETT,
		message: `making search with query "${params.Query}"`,
	});

	return new Promise((resolve, reject) => {
		get.concat(opts, (err, res, data) => {
			if (err) reject(err);
			else resolve(data);
		});
	}).then(parseResponse);
}
