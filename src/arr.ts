import chalk from "chalk";
import ms from "ms";
import { join } from "path";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { Caps, IdSearchParams } from "./torznab.js";
import {
	capitalizeFirstLetter,
	getApikey,
	getTag,
	isTruthy,
	MediaType,
	sanitizeUrl,
} from "./utils.js";

export interface ExternalIds {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}

export type ParseResponse =
	| { movie: ExternalIds }
	| { series: ExternalIds }
	| { status: string };

export async function validateUArrLs() {
	const { sonarr, radarr } = getRuntimeConfig();
	if (!sonarr && !radarr) return;

	if (sonarr) {
		const urls: URL[] = sonarr.map((str) => new URL(str));
		for (const url of urls) {
			if (!url.searchParams.has("apikey")) {
				throw new CrossSeedError(
					`Sonarr url ${url} does not specify an apikey`,
				);
			}
			await checkArrIsActive(url, "Sonarr");
		}
	}
	if (radarr) {
		const urls: URL[] = radarr.map((str) => new URL(str));
		for (const url of urls) {
			if (!url.searchParams.has("apikey")) {
				throw new CrossSeedError(
					`Sonarr url ${url} does not specify an apikey`,
				);
			}
			await checkArrIsActive(url, "Radarr");
		}
	}
}

async function checkArrIsActive(url: URL, arrInstance: string) {
	const apikey = getApikey(url.toString())!;
	url.pathname = join(url.pathname, "/ping");
	const arrPingCheck = await makeArrApiCall(url, apikey);
	if (arrPingCheck.isOk()) {
		const arrPingResponse = arrPingCheck.unwrapOrThrow();
		if (arrPingResponse["status"] !== "OK") {
			throw new CrossSeedError(
				`Failed to establish an "OK" from ${arrInstance} URL: ${url}`,
			);
		}
	} else {
		throw new CrossSeedError(
			`Could not contact ${arrInstance} URL: ${url} - ${arrPingCheck.unwrapErrOrThrow().message}`,
		);
	}
}

async function makeArrApiCall(
	url: URL,
	apikey: string,
): Promise<Result<ParseResponse, Error>> {
	let response: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(ms("5 seconds")),
			headers: { "X-Api-Key": apikey },
		});
	} catch (networkError) {
		if (networkError.name === "AbortError") {
			return resultOfErr(new Error(`connection timeout`));
		}
		return resultOfErr(new Error(networkError));
	}
	if (!response.ok) {
		return resultOfErr(new Error(`${response.status}`));
	}

	const responseBody = (await response.json()) as ParseResponse;
	if (!responseBody) {
		return resultOfErr(new Error("Response was empty"));
	}
	return resultOf(responseBody);
}

async function getExternalIdsFromArr(
	searchee: Searchee,
	uArrL: string,
): Promise<ExternalIds> {
	const apikey = getApikey(uArrL)!;
	const url = new URL(sanitizeUrl(uArrL));

	url.pathname = join(url.pathname, "/api/v3/parse");
	url.searchParams.append("title", searchee.name);

	const response = await makeArrApiCall(url, apikey);

	if (response.isOk()) {
		const responseBody = response.unwrapOrThrow() as ParseResponse;
		if ("movie" in responseBody) {
			const { tvdbId, tmdbId, imdbId } = responseBody.movie;
			return { tvdbId, imdbId, tmdbId };
		} else if ("series" in responseBody) {
			const { tvdbId, tmdbId, imdbId } = responseBody.series;
			return { tvdbId, imdbId, tmdbId };
		}
	}
	throw new Error(response.unwrapErrOrThrow().message);
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
	externalIds: ExternalIds,
	searchTerm: string,
	mediaType: MediaType,
) {
	const label = mediaType === MediaType.MOVIE ? Label.RADARR : Label.SONARR;
	const mediaTypeStr = mediaType === MediaType.MOVIE ? "movie" : "series";
	const foundIdsStr = formatFoundIds(externalIds);
	if (Object.values(externalIds).length > 0) {
		logger.verbose({
			label: label,
			message: `Found ${mediaTypeStr} for ${chalk.green.bold(searchTerm)} -> ${foundIdsStr}`,
		});
	} else {
		logger.verbose({
			label: label,
			message: `Lookup failed for ${chalk.yellow(searchTerm)}`,
		});
		logger.verbose({
			label: label,
			message: `Make sure the ${mediaTypeStr} is added to ${capitalizeFirstLetter(label)}.`,
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

function getRelevantArrInstances(mediaType: MediaType): string[] {
	const { sonarr, radarr } = getRuntimeConfig();
	switch (mediaType) {
		case MediaType.SEASON:
		case MediaType.EPISODE:
			return sonarr ?? [];
		case MediaType.MOVIE:
			return radarr ?? [];
		default:
			return [];
	}
}

export async function scanAllArrsForExternalIds(
	searchee: Searchee,
	mediaType: MediaType,
): Promise<Result<ExternalIds, boolean>> {
	const uArrLs = getRelevantArrInstances(mediaType);
	try {
		for (const uArrL of uArrLs) {
			const externalIds = await getExternalIdsFromArr(searchee, uArrL);
			if (Object.values(externalIds).some(isTruthy)) {
				logArrQueryResult(externalIds, searchee.name, mediaType);
				return resultOf(externalIds);
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
		const result = await scanAllArrsForExternalIds(searchee, mediaType);
		return result.unwrapOrThrow();
	} catch (e) {
		return {};
	}
}
