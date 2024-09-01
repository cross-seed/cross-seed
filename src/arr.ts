import chalk from "chalk";
import ms from "ms";
import { join as posixJoin } from "node:path/posix";
import { URLSearchParams } from "node:url";
import { SCENE_TITLE_REGEX } from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { Caps } from "./indexers.js";
import { Label, logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { IdSearchParams } from "./torznab.js";
import {
	cleanseSeparators,
	getApikey,
	isTruthy,
	MediaType,
	sanitizeUrl,
	stripMetaFromName,
} from "./utils.js";

export interface ExternalIds {
	imdbId?: string;
	tmdbId?: string;
	tvdbId?: string;
	tvMazeId?: string;
}
export function arrIdsEqual(
	a: ExternalIds | undefined,
	b: ExternalIds | undefined,
): boolean {
	return (
		a?.imdbId === b?.imdbId &&
		a?.tmdbId === b?.tmdbId &&
		a?.tvdbId === b?.tvdbId &&
		a?.tvMazeId === b?.tvMazeId
	);
}

interface ParsedMovie {
	movie: ExternalIds;
	series: undefined;
	episodes: undefined;
}

interface ParsedSeries {
	movie: undefined;
	series: ExternalIds;
	episodes: {
		seasonNumber: number;
		episodeNumber: number;
	}[];
}

export type ParsedMedia = ParsedMovie | ParsedSeries;

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
			signal: AbortSignal.timeout(ms("30 seconds")),
			headers: { "X-Api-Key": apikey },
		});
	} catch (networkError) {
		if (
			networkError.name === "AbortError" ||
			networkError.name === "TimeoutError"
		) {
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

async function getMediaFromArr(
	uArrL: string,
	title: string,
): Promise<Result<ParsedMedia, Error>> {
	return await makeArrApiCall<ParsedMedia>(
		uArrL,
		"/api/v3/parse",
		new URLSearchParams({ title }),
	);
}

export function formatFoundIds(foundIds: ExternalIds): string {
	return Object.entries(foundIds)
		.filter(([idName]) =>
			["imdbid", "tmdbid", "tvdbid", "tvmazeid"].includes(
				idName.toLowerCase(),
			),
		)
		.map(([idName, idValue]) => {
			const name = idName.toUpperCase().replace("ID", "");
			const val = idValue ?? "N/A";
			return `${chalk.yellow(name)}=${chalk.white(val)}`;
		})
		.join(" ");
}

function logArrQueryResult(
	externalIds: ExternalIds,
	searchTerm: string,
	label: Label.RADARR | Label.SONARR | Label.ARRS,
	error?: Error,
) {
	if (error) {
		if (!Object.values(externalIds).some(isTruthy)) {
			logger.verbose({
				label: label,
				message: `Lookup failed for ${chalk.yellow(searchTerm)} - ${chalk.red(error.message)} - make sure the item is added to an Arr instance.`,
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
			message: `Found media for ${chalk.green.bold(searchTerm)} -> ${foundIdsStr}`,
		});
	}
}

function getRelevantArrInstances(mediaType: MediaType): string[] {
	const { sonarr, radarr } = getRuntimeConfig();
	switch (mediaType) {
		case MediaType.SEASON:
		case MediaType.EPISODE:
			return sonarr;
		case MediaType.MOVIE:
			return radarr;
		case MediaType.ANIME:
		case MediaType.VIDEO:
			return [...sonarr, ...radarr];
		default:
			return [];
	}
}

export async function scanAllArrsForMedia(
	searcheeTitle: string,
	mediaType: MediaType,
): Promise<Result<ParsedMedia, boolean>> {
	const uArrLs = getRelevantArrInstances(mediaType);
	if (uArrLs.length === 0) {
		return resultOfErr(false);
	}
	const title =
		mediaType !== MediaType.VIDEO
			? searcheeTitle.match(SCENE_TITLE_REGEX)!.groups!.title
			: cleanseSeparators(stripMetaFromName(searcheeTitle));
	let error = new Error(
		`No ids found for ${title} | MediaType: ${mediaType.toUpperCase()}`,
	);
	for (const uArrL of uArrLs) {
		const name =
			mediaType === MediaType.VIDEO &&
			getRuntimeConfig().sonarr?.includes(uArrL)
				? `${title} S00E00` // Sonarr needs season or episode
				: title;
		const result = await getMediaFromArr(uArrL, name);
		if (result.isErr()) {
			error = result.unwrapErr();
			continue;
		}
		const response = result.unwrap();
		const ids = response.movie ?? response.series ?? {};
		for (const [key, value] of Object.entries(ids)) {
			if (value === 0 || value === "0") {
				ids[key] = undefined;
			}
		}
		if (Object.values(ids).some(isTruthy)) {
			const label = response.movie ? Label.RADARR : Label.SONARR;
			logArrQueryResult(ids, name, label);
			return resultOf(response);
		}
	}
	logArrQueryResult({}, searcheeTitle, Label.ARRS, error);
	return resultOfErr(false);
}

export async function getRelevantArrIds(
	caps: Caps,
	parsedMedia: ParsedMedia,
): Promise<IdSearchParams> {
	const idSearchCaps = parsedMedia.movie
		? caps.movieIdSearch
		: caps.tvIdSearch;
	const ids = parsedMedia.movie ?? parsedMedia.series;
	const x = {
		tvdbid: idSearchCaps.tvdbId ? ids.tvdbId : undefined,
		tmdbid: idSearchCaps.tmdbId ? ids.tmdbId : undefined,
		imdbid: idSearchCaps.imdbId ? ids.imdbId : undefined,
		tvmazeid: idSearchCaps.tvMazeId ? ids.tvMazeId : undefined,
	};
	return x;
}
