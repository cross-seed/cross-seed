import chalk from "chalk";
import ms from "ms";
import { join as posixJoin } from "node:path/posix";
import { URLSearchParams } from "node:url";
import type { Problem } from "./problems.js";
import { MediaType, SCENE_TITLE_REGEX, USER_AGENT } from "./constants.js";
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
	let clonedResponse: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(ms("30 seconds")),
			headers: { "X-Api-Key": apikey, "User-Agent": USER_AGENT },
		});
		clonedResponse = response.clone();
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
				`${response.status === 401 ? "401 Unauthorized (check apikey)" : response.status} ${response.statusText} ${bodySampleMessage}`,
			),
		);
	}
	try {
		const responseBody = await response.json();
		return resultOf(responseBody as ResponseType);
	} catch (e) {
		const responseText = await clonedResponse.text();
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
	return makeArrApiCall<ParsedMedia>(
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

export function getRelevantArrIds(
	caps: Caps,
	parsedMedia: ParsedMedia,
): IdSearchParams {
	const idSearchCaps = parsedMedia.movie
		? caps.movieIdSearch
		: caps.tvIdSearch;
	const ids = parsedMedia.movie ?? parsedMedia.series;
	return {
		tvdbid: idSearchCaps.tvdbId ? ids.tvdbId : undefined,
		tmdbid: idSearchCaps.tmdbId ? ids.tmdbId : undefined,
		imdbid: idSearchCaps.imdbId ? ids.imdbId : undefined,
		tvmazeid: idSearchCaps.tvMazeId ? ids.tvMazeId : undefined,
	};
}

type ArrKind = "Sonarr" | "Radarr";

function sanitizeDisplayUrl(url: URL): string {
	return `${url.origin}${url.pathname}`;
}

function arrProblemId(
	kind: ArrKind,
	category: string,
	index: number,
): string {
	return `arr:${kind.toLowerCase()}:${category}:${index}`;
}

async function checkArrUrl(
	rawUrl: string,
	index: number,
	kind: ArrKind,
): Promise<Problem[]> {
	const problems: Problem[] = [];
	let parsedUrl: URL;

	try {
		parsedUrl = new URL(rawUrl);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error ?? "Unknown error");
		problems.push({
			id: arrProblemId(kind, "invalid-url", index),
			severity: "error",
			summary: `${kind} URL ${index + 1} is invalid.`,
			details: message,
		});
		return problems;
	}

	const displayUrl = sanitizeDisplayUrl(parsedUrl);

	if (!parsedUrl.pathname.endsWith("/api")) {
		problems.push({
			id: arrProblemId(kind, "missing-api-path", index),
			severity: "error",
			summary: `${kind} URL must end with "/api".`,
			details: `Update ${displayUrl} so the path ends with /api.`,
		});
	}

	const apiKey = parsedUrl.searchParams.get("apikey");
	if (!apiKey) {
		problems.push({
			id: arrProblemId(kind, "missing-apikey", index),
			severity: "error",
			summary: `${kind} URL is missing an apikey parameter.`,
			details: `Add ?apikey=<KEY> (or &apikey when other parameters exist) to ${displayUrl}.`,
		});
		return problems;
	}

	try {
		const response = await fetch(parsedUrl, {
			signal: AbortSignal.timeout(30_000),
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) {
			problems.push({
				id: arrProblemId(kind, "http-error", index),
				severity: "error",
				summary: `${kind} at ${displayUrl} responded with ${response.status}.`,
				details: `Status text: ${response.statusText || "Unknown status"}.`,
			});
			return problems;
		}

		try {
			const body = (await response.json()) as { current?: unknown };
			if (typeof body?.current !== "string" || body.current.length === 0) {
				problems.push({
					id: arrProblemId(kind, "unexpected-response", index),
					severity: "warning",
					summary: `${kind} at ${displayUrl} returned an unexpected response.`,
					details:
						"cross-seed expected a version string from /api but received something else.",
				});
			}
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unable to parse response from Arr instance.";
			problems.push({
				id: arrProblemId(kind, "invalid-json", index),
				severity: "warning",
				summary: `${kind} at ${displayUrl} returned non-JSON data.`,
				details: message,
			});
		}
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error ?? "Unknown error");
		const isAbort =
			typeof error === "object" &&
			error !== null &&
			"name" in error &&
			(error as { name?: string }).name === "TimeoutError";
		problems.push({
			id: arrProblemId(kind, "network-error", index),
			severity: "error",
			summary: `${kind} at ${displayUrl} could not be reached.`,
			details: isAbort
				? "The request timed out after 30 seconds."
				: message,
		});
	}

	return problems;
}

export async function collectArrProblems(): Promise<Problem[]> {
	const { sonarr = [], radarr = [] } = getRuntimeConfig();
	const problems: Problem[] = [];
	const hasSonarr = Array.isArray(sonarr) && sonarr.length > 0;
	const hasRadarr = Array.isArray(radarr) && radarr.length > 0;

	if (!hasSonarr && !hasRadarr) {
		problems.push({
			id: "arr:not-configured",
			severity: "info",
			summary: "Sonarr/Radarr integrations are not configured.",
			details:
				"Configure Arr URLs if you want cross-seed to sync release history or send notifications.",
		});
		return problems;
	}

	await Promise.all([
		...sonarr.map((url, index) => checkArrUrl(url, index, "Sonarr")),
		...radarr.map((url, index) => checkArrUrl(url, index, "Radarr")),
	]).then((results) => {
		for (const arrProblems of results) {
			problems.push(...arrProblems);
		}
	});

	return problems;
}
