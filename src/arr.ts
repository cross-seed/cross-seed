import chalk from "chalk";
import ms from "ms";
import { join as posixJoin } from "node:path/posix";
import { URLSearchParams } from "node:url";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { Caps, IdSearchParams } from "./torznab.js";
import {
	capitalizeFirstLetter,
	getApikey,
	getMediaType,
	isTruthy,
	MediaType,
	sanitizeUrl,
} from "./utils.js";

export interface ExternalIds {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
}

export type ParseResponse = { movie: ExternalIds } | { series: ExternalIds };

export async function validateUArrLs() {
	const { sonarr, radarr } = getRuntimeConfig();

	if (sonarr) {
		const urls: URL[] = sonarr.map((str) => new URL(str));
		for (const url of urls) {
			if (!url.searchParams.has("apikey")) {
				throw new CrossSeedError(
					`Sonarr url ${url} does not specify an apikey`,
				);
			}
			await checkArrIsActive(url.href, "Sonarr");
		}
	}
	if (radarr) {
		const urls: URL[] = radarr.map((str) => new URL(str));
		for (const url of urls) {
			if (!url.searchParams.has("apikey")) {
				throw new CrossSeedError(
					`Radarr url ${url} does not specify an apikey`,
				);
			}
			await checkArrIsActive(url.href, "Radarr");
		}
	}
}

async function checkArrIsActive(uArrL: string, arrInstance: string) {
	const arrPingCheck = await makeArrApiCall<{
		current: string;
	}>(uArrL, "/api");

	if (arrPingCheck.isOk()) {
		const arrPingResponse = arrPingCheck.unwrap();
		if (!arrPingResponse?.current) {
			throw new CrossSeedError(
				`Failed to establish a connection to ${arrInstance} URL: ${uArrL}`,
			);
		}
	} else {
		const error = arrPingCheck.unwrapErr();
		throw new CrossSeedError(
			`Could not contact ${arrInstance} at ${uArrL}`,
			{
				cause:
					error.message.includes("fetch failed") && error.cause
						? error.cause
						: error,
			},
		);
	}
}

function getBodySampleMessage(text: string): string {
	const first1000Chars = text.substring(0, 1000);
	if (first1000Chars) {
		return `first 1000 characters: ${first1000Chars}`;
	} else {
		return "";
	}
}

async function makeArrApiCall<ResponseType>(
	uArrL: string,
	resourcePath: string,
	params = new URLSearchParams(),
): Promise<Result<ResponseType, Error>> {
	const apikey = getApikey(uArrL)!;
	const url = new URL(sanitizeUrl(uArrL));

	url.pathname = posixJoin(url.pathname, resourcePath);
	for (const [name, value] of params) {
		url.searchParams.set(name, value);
	}

	let response: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(ms("5 seconds")),
			headers: { "X-Api-Key": apikey },
		});
	} catch (networkError) {
		if (networkError.name === "AbortError") {
			return resultOfErr(new Error("connection timeout"));
		}
		return resultOfErr(networkError);
	}
	if (!response.ok) {
		const responseText = await response.text();
		const bodySampleMessage = getBodySampleMessage(responseText);
		return resultOfErr(
			new Error(
				`${response.status} ${response.statusText} ${bodySampleMessage}`,
			),
		);
	}
	try {
		const responseBody = await response.clone().json();
		return resultOf(responseBody as ResponseType);
	} catch (e) {
		const responseText = await response.text();
		return resultOfErr(
			new Error(
				`Arr response was non-JSON. ${getBodySampleMessage(responseText)}`,
			),
		);
	}
}

async function getExternalIdsFromArr(
	searchee: Searchee,
	uArrL: string,
): Promise<ExternalIds> {
	const response = await makeArrApiCall<ParseResponse>(
		uArrL,
		"/api/v3/parse",
		new URLSearchParams({ title: searchee.name }),
	);

	if (response.isOk()) {
		const responseBody = response.unwrap() as ParseResponse;
		if ("movie" in responseBody) {
			const { tvdbId, tmdbId, imdbId } = responseBody.movie;
			return { tvdbId, imdbId, tmdbId };
		} else if ("series" in responseBody) {
			const { tvdbId, tmdbId, imdbId } = responseBody.series;
			return { tvdbId, imdbId, tmdbId };
		}
	}
	return {};
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
	error?: Error,
) {
	const mediaTypeStr = mediaType === MediaType.MOVIE ? "movie" : "series";
	const label = mediaType === MediaType.MOVIE ? Label.RADARR : Label.SONARR;
	if (error) {
		if (!Object.values(externalIds).some(isTruthy)) {
			logger.verbose({
				label: label,
				message: `Lookup failed for ${chalk.yellow(searchTerm)}`,
			});
			logger.verbose({
				label: label,
				message: `Make sure the ${mediaTypeStr} is added to ${capitalizeFirstLetter(label)}.`,
			});
			return;
		}
		logger.debug({
			label: label,
			message: `Failed to lookup IDs for ${chalk.yellow(
				searchTerm,
			)} - (${chalk.red(String(error).split(":").slice(1)[0].trim())})`,
		});
		logger.debug(error);
	} else {
		const foundIdsStr = formatFoundIds(externalIds);
		logger.verbose({
			label: label,
			message: `Found ${mediaTypeStr} for ${chalk.green.bold(searchTerm)} -> ${foundIdsStr}`,
		});
	}
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
		logArrQueryResult({}, searchee.name, mediaType, error);
		return resultOfErr(false);
	}
}

export async function getRelevantArrIds(
	searchee: Searchee,
	ids: ExternalIds,
	caps: Caps,
): Promise<IdSearchParams> {
	const mediaType = getMediaType(searchee);
	const idSearchCaps =
		mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? caps.tvIdSearch
			: caps.movieIdSearch;

	return {
		tvdbid: idSearchCaps.tvdbId ? ids.tvdbId : undefined,
		tmdbid: idSearchCaps.tmdbId ? ids.tmdbId : undefined,
		imdbid: idSearchCaps.imdbId ? ids.imdbId : undefined,
	};
}

export async function getAvailableArrIds(
	searchee: Searchee,
): Promise<ExternalIds> {
	const mediaType = getMediaType(searchee);
	const result = await scanAllArrsForExternalIds(searchee, mediaType);
	return result.orElse({});
}
