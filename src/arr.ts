import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { MediaType } from "./utils.js";
import { getApikey, sanitizeUrl } from "./torznab.js";
import chalk from "chalk";
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
	const uarrl = { apikey: getApikey(url), url: sanitizeUrl(url) };
	const lookupUrl = `${uarrl.url}/v3/parse?apikey=${uarrl.apikey}&title=${searchterm}`;
	const response = await fetch(lookupUrl);
	let parsedData: idData;
	if (!response.ok) {
		logger.warn(
			`unable to lookup corresponding id for ${searchterm}: Status Code -> ${response.status} `
		);
		throw new Error(`${response.status}`);
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
}

function formatFoundIds(arrJson: idData): string {
	return `${
		arrJson.tvdbId
			? `${chalk.yellow("TVDB")}: ${chalk.white(arrJson.tvdbId)} `
			: ""
	}${
		arrJson.tmdbId
			? `${chalk.yellow("TMDB")}: ${chalk.white(arrJson.tmdbId)} `
			: ""
	}${
		arrJson.imdbId
			? `${chalk.yellow("IMDB")}: ${chalk.white(arrJson.imdbId)}`
			: ""
	}`;
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
			if (!isEmptyObject(arrJson)) {
				logger.info({
					label: Label.SONARR_API,
					message: `${chalk.cyan("Found series")} -> ${formatFoundIds(
						arrJson
					)}`,
				});
			} else {
				logger.error({
					label: Label.SONARR_API,
					message: `Lookup for ${chalk.yellow(searchterm)} failed.`,
				});
				logger.warn({
					label: Label.SONARR_API,
					message: `Make sure the series is added to Sonarr.`,
				});
			}
			return resultOf(arrJson);
		} catch (error) {
			logger.error({
				label: Label.SONARR_API,
				message: `Failed to lookup IDs for ${chalk.yellow(
					searchterm
				)} - (${chalk.red(
					String(error).split(":").slice(1)[0].trim()
				)})`,
			});
			logger.debug(error);
			return resultOfErr(false);
		}
	} else if (mediaType === MediaType.MOVIE) {
		try {
			const arrJson = (await fetchArrJSON(
				searchterm,
				radarrApi!,
				mediaType
			)) as idData;
			if (!isEmptyObject(arrJson)) {
				logger.info({
					label: Label.RADARR_API,
					message: `${chalk.cyan("Found movie")} -> ${formatFoundIds(
						arrJson
					)}`,
				});
			} else {
				logger.error({
					label: Label.RADARR_API,
					message: `Lookup for ${chalk.yellow(searchterm)} failed.`,
				});
				logger.warn({
					label: Label.RADARR_API,
					message: `Make sure the movie is added to Radarr.`,
				});
			}
			return resultOf(arrJson);
		} catch (error) {
			logger.error({
				label: Label.RADARR_API,
				message: `Failed to lookup IDs for ${chalk.yellow(
					searchterm
				)} - (${chalk.red(
					String(error).split(":").slice(1)[0].trim()
				)})`,
			});
			logger.debug(error);
			return resultOfErr(false);
		}
	} else {
		return resultOfErr(false);
	}
}
