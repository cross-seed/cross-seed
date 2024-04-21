import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { MediaType } from "./utils.js";
import { getApikey, sanitizeUrl } from "./torznab.js";
export type idData = {
	imdbId: string | undefined;
	tmdbId: string | undefined;
	tvdbId: string | undefined;
};
async function fetchArrJSON(
	searchterm: string,
	url: string,
	mediaType: MediaType
): Promise<idData> {
	try {
		const apikey = getApikey(url);
		const arrUrl = sanitizeUrl(url);
		const lookupUrl = `${arrUrl}/v3/${
			mediaType === MediaType.MOVIE ? "movie" : "series"
		}/lookup?apikey=${apikey}&term=${searchterm}`;
		const response = await fetch(lookupUrl);
		if (!response.ok) {
			logger.warn(
				`unable to lookup corresponding id for ${searchterm}: Status Code -> ${response.status} `
			);
			throw new Error(`HTTP error! Status: ${response.status}`);
		}
		const idLookup = (await response.json()) as idData;
		return idLookup;
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
	if (!sonarrApi || !radarrApi) {
		return resultOfErr(false);
	}
	if (
		sonarrApi &&
		(mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON)
	) {
		try {
			const arrJson = (await fetchArrJSON(
				searchterm,
				sonarrApi,
				MediaType.EPISODE
			)) as idData;
			console.log(
				`idLookup results -> TVDB: ${arrJson[0].tvdbId} IMDB: ${arrJson[0].imdbId} TMDB: ${arrJson[0].tmdbId}`
			);
			return resultOf(arrJson[0]);
		} catch (error) {
			logger.error(`failed to lookup id for ${searchterm}: ${error}`);
			return resultOfErr(false);
		}
	} else if (radarrApi && mediaType === MediaType.MOVIE) {
		try {
			const arrJson = (await fetchArrJSON(
				searchterm,
				radarrApi,
				MediaType.MOVIE
			)) as idData;
			console.log(
				`idLookup results -> IMDB: ${arrJson[0].imdbId} TMDB: ${arrJson[0].tmdbId}`
			);
			return resultOf(arrJson[0]);
		} catch (error) {
			logger.error(`failed to lookup id for ${searchterm}: ${error}`);
			return resultOfErr(false);
		}
	} else {
		return resultOfErr(false);
	}
}
