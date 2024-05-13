import chalk from "chalk";
import ms from "ms";
import { join } from "path";
import { Label, logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { Caps, IdSearchParams } from "./torznab.js";
import { getApikey, getTag, MediaType, sanitizeUrl } from "./utils.js";

export interface ExternalIds {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}

export type ParseResponse = { movie: ExternalIds } | { series: ExternalIds };

async function getExternalIdsFromArr(
	searchee: Searchee,
	uArrL: string,
): Promise<ExternalIds> {
	const apikey = getApikey(uArrL)!;
	const url = new URL(sanitizeUrl(uArrL));

	url.pathname = join(url.pathname, "/api/v3/parse");
	url.searchParams.append("title", searchee.name);

	let response: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(ms("5 seconds")),
			headers: { "X-Api-Key": apikey },
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

	const responseBody = (await response.json()) as ParseResponse;
	if (!responseBody) {
		return {};
	}

	if ("movie" in responseBody) {
		const { tvdbId, tmdbId, imdbId } = responseBody.movie;
		return { tvdbId, imdbId, tmdbId };
	} else {
		const { tvdbId, tmdbId, imdbId } = responseBody.series;
		return { tvdbId, imdbId, tmdbId };
	}
}

function formatFoundIds(foundIds: ExternalIds): string {
	return Object.entries(foundIds)
		.filter(([, idValue]) => idValue)
		.map(([idName, idValue]) => {
			const externalProvider = idName.toUpperCase().replace("ID", "");
			return `${chalk.yellow(externalProvider)}: ${chalk.white(idValue)}`;
		})
		.join(" ");
}

function logArrQueryResult(
	arrJson: ExternalIds,
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

function searchUArrLs(mediaType: MediaType): string[] | undefined {
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
): Promise<Result<ExternalIds, boolean>> {
	const UArrLs = searchUArrLs(mediaType);
	if (!UArrLs) {
		return resultOfErr(false);
	}
	try {
		let arrJson: ExternalIds;
		for (let i = 0; i < UArrLs.length; i++) {
			arrJson = await getExternalIdsFromArr(searchee, UArrLs[i]);
			if (Object.keys(arrJson).length > 0) {
				logArrQueryResult(arrJson, searchee.name, mediaType);
				return resultOf(arrJson);
			}
		}
		throw new Error("fall through to catch");
	} catch (error) {
		logArrQueryFailure(error, searchee.name, mediaType);
		return resultOfErr(false);
	}
}
export async function getRelevantArrIds(
	searchee: Searchee,
	ids: ExternalIds,
	caps: Caps,
): Promise<IdSearchParams> {
	const mediaType = getTag(searchee);
	const idSearchCaps =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? caps.tvIdSearch
			: caps.movieIdSearch;

	return {
		tvdbid: idSearchCaps.tvdbId ? ids.tvdbId : undefined,
		tmdbid: idSearchCaps.tvdbId ? ids.tmdbId : undefined,
		imdbid: idSearchCaps.imdbId ? ids.imdbId : undefined,
	};
}

export async function getAvailableArrIds(
	searchee: Searchee,
): Promise<ExternalIds> {
	const mediaType = getTag(searchee);
	try {
		return (await grabArrId(searchee, mediaType)).unwrapOrThrow();
	} catch (e) {
		return {};
	}
}
