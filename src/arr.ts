import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import {
	assembleUrl,
	getApikey,
	getTag,
	MediaType,
	sanitizeUrl,
	stripExtension,
} from "./utils.js";
import chalk from "chalk";
import { hasVideo, Searchee } from "./searchee.js";
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

async function fetchArrJSON(
	searchTerm: string,
	url: string,
	mediaType: MediaType
): Promise<IdData> {
	const uarrl = { apikey: getApikey(url), url: sanitizeUrl(url) };
	let response;
	const lookupUrl = assembleUrl(
		`${uarrl.url}api/v3/parse`,
		uarrl.apikey as string,
		{
			title: searchTerm,
		} as IdSearchParams
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
	const ids =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? arrJson?.series
			: arrJson?.movie;

	const x: { [key: string]: string } = Object.fromEntries(
		keyNames
			.map((key) => {
				const arrIds = ids?.[key] as string;
				return arrIds !== undefined && arrIds !== ""
					? [key, arrIds]
					: undefined;
			})
			.filter((entry) => entry !== undefined) as [string, string][]
	);
	return x;
}

function formatFoundIds(arrJson: IdData): string {
	let formattedIds = "";
	keyNames.forEach((key) => {
		if (arrJson[key]) {
			formattedIds += `${chalk.yellow(
				key.toUpperCase().replace("ID", "")
			)}: ${chalk.white(arrJson[key])} `;
		}
	});
	return formattedIds.trim();
}

function logArrQueryResult(
	arrJson: IdData,
	searchTerm: string,
	mediaType: MediaType
) {
	const label = mediaType === MediaType.MOVIE ? Label.RADARR : Label.SONARR;
	if (Object.keys(arrJson).length > 0) {
		logger.verbose({
			label: label,
			message: `Found ${
				label === Label.RADARR ? "movie" : "series"
			} for ${chalk.green.bold(searchTerm)} -> ${formatFoundIds(
				arrJson
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
			searchTerm
		)} - (${chalk.red(String(error).split(":").slice(1)[0].trim())})`,
	});
	logger.debug(error);
}

export async function grabArrId(
	searchTerm: string,
	mediaType: MediaType
): Promise<Result<IdData, boolean>> {
	const { sonarr, radarr } = getRuntimeConfig();
	if (
		(!sonarr &&
			(mediaType == MediaType.EPISODE ||
				mediaType === MediaType.SEASON)) ||
		(!radarr && mediaType === MediaType.MOVIE)
	) {
		return resultOfErr(false);
	}
	try {
		const arrJson = (await fetchArrJSON(
			searchTerm,
			mediaType === MediaType.MOVIE ? radarr! : sonarr!,
			mediaType
		)) as IdData;
		logArrQueryResult(arrJson, searchTerm, mediaType);
		return resultOf(arrJson);
	} catch (error) {
		logArrQueryFailure(error, searchTerm, mediaType);
		return resultOfErr(false);
	}
}
export async function getRelevantArrIds(
	searchee: Searchee,
	ids,
	caps: Caps
): Promise<IdSearchParams> {
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
): Promise<IdSearchParams> {
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
