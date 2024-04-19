import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { MediaType } from "./utils.js";
import { getApikey, sanitizeUrl } from "./torznab.js";
import {
	assembleUrl,
	getApikey,
	getTag,
	MediaType,
	sanitizeUrl,
	stripExtension,
} from "./utils.js";
import chalk from "chalk";
import { Caps, TorznabParams } from "./torznab.js";
import { hasVideo, Searchee } from "./searchee.js";
export type ParseResponse = {
	movie?: IdData;
	series?: IdData;
};
export interface IdData {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}
async function fetchArrJSON(
	searchTerm: string,
	url: string,
	mediaType: MediaType
): Promise<IdData> {
	const uarrl = { apikey: getApikey(url), url: sanitizeUrl(url) };
	let response;
	const lookupUrl = assembleUrl(
		`${uarrl.url}/v3/parse`,
		uarrl.apikey as string,
		{
			title: searchTerm,
		}
	);

	const abortController = new AbortController();
	setTimeout(() => void abortController.abort(), 10000).unref();
	try {
		response = await fetch(lookupUrl, {
			signal: abortController.signal,
		});
	} catch (networkError) {
		if (networkError.name === "AbortError") {
			throw new Error(`connection timeout`);
		}
		throw new Error(networkError);
	}
	if (!response.ok) {
		throw new Error(`${response.status}`);
	}
	const arrJson = (await response.json()) as ParseResponse;
	const ids =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? arrJson?.series
			: arrJson?.movie;
	return {
		imdbId: ids?.imdbId,
		tmdbId: ids?.tmdbId,
		tvdbId: ids?.tvdbId,
	};
}

export async function grabArrId(
	searchTerm: string,
	mediaType: MediaType
): Promise<Result<IdData, boolean>> {
	const { sonarr, radarr } = getRuntimeConfig();
	function formatFoundIds(arrJson: IdData): string {
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
	if (
		(!sonarr &&
			(mediaType == MediaType.EPISODE ||
				mediaType === MediaType.SEASON)) ||
		(!radarr && mediaType === MediaType.MOVIE)
	) {
		return resultOfErr(false);
	}
	if (mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON) {
		try {
			const arrJson = (await fetchArrJSON(
				searchTerm,
				sonarr!,
				mediaType
			)) as IdData;
			if (Object.keys(arrJson).length > 0) {
				logger.info({
					label: Label.SONARR,
					message: `${chalk.cyan("Found series")} -> ${formatFoundIds(
						arrJson
					)}`,
				});
			} else {
				logger.verbose({
					label: Label.SONARR,
					message: `Lookup for ${chalk.yellow(searchTerm)} failed.`,
				});
				logger.verbose({
					label: Label.SONARR,
					message: `Make sure the series is added to Sonarr.`,
				});
			}
			return resultOf(arrJson);
		} catch (error) {
			logger.debug({
				label: Label.SONARR,
				message: `Failed to lookup IDs for ${chalk.yellow(
					searchTerm
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
				searchTerm,
				radarr!,
				mediaType
			)) as IdData;
			if (Object.keys(arrJson).length > 0) {
				logger.info({
					label: Label.RADARR,
					message: `${chalk.cyan("Found movie")} -> ${formatFoundIds(
						arrJson
					)}`,
				});
			} else {
				logger.verbose({
					label: Label.RADARR,
					message: `Lookup for ${chalk.yellow(searchTerm)} failed.`,
				});
				logger.verbose({
					label: Label.RADARR,
					message: `Make sure the movie is added to Radarr.`,
				});
			}
			return resultOf(arrJson);
		} catch (error) {
			logger.debug({
				label: Label.RADARR,
				message: `Failed to lookup IDs for ${chalk.yellow(
					searchTerm
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
export async function getRelevantArrIds(
	searchee: Searchee,
	ids,
	caps: Caps
): Promise<TorznabParams> {
	const nameWithoutExtension = stripExtension(searchee.name);
	const mediaType = getTag(nameWithoutExtension, hasVideo(searchee));
	const idSearchCaps =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? caps.tvIdSearch
			: caps.movieIdSearch;

	return Object.keys(idSearchCaps).reduce((acc, key) => {
		const lowerKey = String(key).toLowerCase();
		if (idSearchCaps[key] && ids[key]) {
			acc[lowerKey] = ids[key];
		}
		return acc;
	}, {});
}

export async function getAvailableArrIds(
	searchee: Searchee
): Promise<TorznabParams> {
	const nameWithoutExtension = stripExtension(searchee.name);
	const mediaType = getTag(nameWithoutExtension, hasVideo(searchee));
	try {
		const arrIdData = (
			await grabArrId(searchee.name, mediaType)
		).unwrapOrThrow();
		return arrIdData as TorznabParams;
	} catch (e) {
		return {};
	}
}
