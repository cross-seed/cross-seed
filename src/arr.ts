import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import {
	assembleUrl,
	getApikey,
	getTag,
	MediaType,
	sanitizeUrl,
} from "./utils.js";
import chalk from "chalk";
import { Searchee } from "./searchee.js";
import { Caps, IdSearchParams, TorznabParams } from "./torznab.js";

const keyNames = ["tvdbId", "imdbId", "tmdbId"];

export type ParseResponse = {
	movie?: IdData;
	series?: IdData;
};
export interface IdData {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}

async function fetchArrJSON(searchee: Searchee, url: string): Promise<IdData> {
	const uarrl = { apikey: getApikey(url), url: sanitizeUrl(url) };
	let response;
	const lookupUrl = assembleUrl(
		`${uarrl.url}api/v3/parse`,
		uarrl.apikey as string,
		{
			title: searchee.name,
		} as IdSearchParams,
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
	if (!arrJson) {
		return {};
	}
	function whichArr(searchee: Searchee) {
		const mediaType = getTag(searchee);
		switch (mediaType) {
			case MediaType.SEASON:
			case MediaType.EPISODE:
				return arrJson?.series;
			case MediaType.MOVIE:
				return arrJson?.movie;
			default:
		}
	}

	return Object.fromEntries(
		keyNames
			.map((key) => {
				const arrIds = whichArr(searchee)?.[key];
				return arrIds !== undefined && arrIds !== ""
					? [key, arrIds]
					: undefined;
			})
			.filter((entry) => entry !== undefined) as [string, string][],
	);
}

function formatFoundIds(arrJson: IdData): string {
	let formattedIds = "";
	keyNames.forEach((key) => {
		if (arrJson[key]) {
			formattedIds += `${chalk.yellow(
				key.toUpperCase().replace("ID", ""),
			)}: ${chalk.white(arrJson[key])} `;
		}
	});
	return formattedIds.trim();
}

function logArrQueryResult(
	arrJson: IdData,
	searchTerm: string,
	mediaType: MediaType,
) {
	const label = mediaType === MediaType.MOVIE ? Label.RADARR : Label.SONARR;
	if (Object.keys(arrJson).length > 0) {
		logger.verbose({
			label: label,
			message: `Found ${
				label === Label.RADARR ? "movie" : "series"
			} for ${chalk.green.bold(searchTerm)} -> ${formatFoundIds(
				arrJson,
			)}`,
		});
	} else {
		logger.verbose({
			label: label,
			message: `Lookup failed for ${chalk.yellow(searchTerm)}`,
		});
		logger.verbose({
			label: label,
			message: `Make sure the ${
				label === Label.RADARR ? "movie" : "series"
			} is added to ${label === Label.RADARR ? "Radarr" : "Sonarr"}.`,
		});
	}
}

function logArrQueryFailure(error, searchTerm: string, mediaType: MediaType) {
	const label = mediaType === MediaType.MOVIE ? Label.RADARR : Label.SONARR;
	logger.debug({
		label: label,
		message: `Failed to lookup IDs for ${chalk.yellow(
			searchTerm,
		)} - (${chalk.red(String(error).split(":").slice(1)[0].trim())})`,
	});
	logger.debug(error);
}
function searchUArrL(mediaType: MediaType): string | undefined {
	const { sonarr, radarr } = getRuntimeConfig();
	switch (mediaType) {
		case MediaType.SEASON:
		case MediaType.EPISODE:
			return sonarr;
		case MediaType.MOVIE:
			return radarr;
		default:
			return undefined;
	}
}
export async function grabArrId(
	searchee: Searchee,
	mediaType: MediaType,
): Promise<Result<IdData, boolean>> {
	const uArrL = searchUArrL(mediaType);
	if (!uArrL) {
		return resultOfErr(false);
	}
	try {
		const arrJson = (await fetchArrJSON(searchee, uArrL)) as IdData;
		logArrQueryResult(arrJson, searchee.name, mediaType);
		return resultOf(arrJson);
	} catch (error) {
		logArrQueryFailure(error, searchee.name, mediaType);
		return resultOfErr(false);
	}
}
export async function getRelevantArrIds(
	searchee: Searchee,
	ids,
	caps: Caps,
): Promise<IdSearchParams> {
	const mediaType = getTag(searchee);
	const idSearchCaps =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? caps.tvIdSearch
			: caps.movieIdSearch;

	return Object.keys(idSearchCaps).reduce((acc, key) => {
		if (idSearchCaps[key] && ids[key]) {
			acc[String(key).toLowerCase()] = ids[key];
		}
		return acc;
	}, {});
}

export async function getAvailableArrIds(
	searchee: Searchee,
): Promise<IdSearchParams> {
	const mediaType = getTag(searchee);
	try {
		const arrIdData = (
			await grabArrId(searchee, mediaType)
		).unwrapOrThrow();
		return arrIdData as TorznabParams;
	} catch (e) {
		return {};
	}
}
