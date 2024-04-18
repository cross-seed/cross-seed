import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { MediaType } from "./utils.js";
import { getApikey, sanitizeUrl } from "./torznab.js";
export type ArrJson = {
	movie?: idData;
	series?: idData;
};
export interface idData {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}
async function fetchArrJSON(
	searchterm: string,
	url: string,
	mediaType: MediaType
): Promise<idData> {
	try {
		const uarrl = { apikey: getApikey(url), url: sanitizeUrl(url) };
		const lookupUrl = `${uarrl.url}/v3/parse?apikey=${uarrl.apikey}&title=${searchterm}`;
		const response = await fetch(lookupUrl);
		let parsedData: idData;
		if (!response.ok) {
			logger.warn(
				`unable to lookup corresponding id for ${searchterm}: Status Code -> ${response.status} `
			);
			throw new Error(`HTTP error! Status: ${response.status}`);
		}
		const arrJson = (await response.json()) as ArrJson;
		if (mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON) {
			parsedData = {
				imdbId: arrJson?.series?.imdbId,
				tmdbId: arrJson?.series?.tmdbId,
				tvdbId: arrJson?.series?.tvdbId,
			};
		} else if (mediaType === MediaType.MOVIE) {
			parsedData = {
				imdbId: arrJson?.movie?.imdbId,
				tmdbId: arrJson?.movie?.tmdbId,
				tvdbId: arrJson?.movie?.tvdbId,
			};
		} else {
			parsedData = {};
		}
		return parsedData;
	} catch (error) {
		logger.error(`failed to lookup id for ${searchterm}: ${error}`);
		throw error;
	}
}
export async function grabArrId(
	searchterm: string,
	mediaType: MediaType
): Promise<Result<idData, boolean>> {
	const { sonarrApi, radarrApi } = getRuntimeConfig();
	if (
		(!sonarrApi &&
			(mediaType == MediaType.EPISODE ||
				mediaType === MediaType.SEASON)) ||
		(!radarrApi && mediaType === MediaType.MOVIE)
	) {
		return resultOfErr(false);
	}
	if (mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON) {
		try {
			const arrJson = (await fetchArrJSON(
				searchterm,
				sonarrApi!,
				mediaType
			)) as idData;
			logger.info(
				`idLookup results -> TVDB: ${arrJson.tvdbId} IMDB: ${arrJson.imdbId} TMDB: ${arrJson.tmdbId}`
			);
			return resultOf(arrJson);
		} catch (error) {
			logger.error(`failed to lookup id for ${searchterm}: ${error}`);
			return resultOfErr(false);
		}
	} else if (mediaType === MediaType.MOVIE) {
		try {
			const arrJson = (await fetchArrJSON(
				searchterm,
				radarrApi!,
				mediaType
			)) as idData;
			logger.info(
				`idLookup results -> IMDB: ${arrJson.imdbId} TMDB: ${arrJson.tmdbId}`
			);
			return resultOf(arrJson);
		} catch (error) {
			logger.error(`failed to lookup id for ${searchterm}: ${error}`);
			return resultOfErr(false);
		}
	} else {
		return resultOfErr(false);
	}
}
