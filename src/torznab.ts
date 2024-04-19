import ms from "ms";
import xml2js from "xml2js";
import {
	EP_REGEX,
	MOVIE_REGEX,
	SEASON_REGEX,
	USER_AGENT,
} from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import {
	getEnabledIndexers,
	Indexer,
	IndexerStatus,
	updateIndexerStatus,
} from "./indexers.js";
import { Label, logger } from "./logger.js";
import { Candidate } from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee, hasVideo } from "./searchee.js";
import {
<<<<<<< HEAD
	getAnimeQueries,
=======
>>>>>>> ffabaf1 (cleanup(torznab): housekeeping)
	cleanseSeparators,
	getTag,
	MediaType,
	nMsAgo,
	reformatTitleForSearching,
	stripExtension,
} from "./utils.js";
import { grabArrId } from "./arr.js";

interface TorznabParams {
	t?: "caps" | "search" | "tvsearch" | "movie";
	q?: string;
	limit?: number;
	apikey?: string;
	season?: number | string;
	ep?: number | string;
	tvdbid?: string;
	tmdbid?: string;
	imdbid?: string;
}
export interface IdSearchCaps {
	tvdbId: boolean;
	tmdbId: boolean;
	imdbId: boolean;
}
interface Caps {
	search: boolean;
	tvSearch: boolean;
	movieSearch: boolean;
	movieIdSearch: IdSearchCaps;
	tvIdSearch: IdSearchCaps;
}

type TorznabSearchTechnique =
	| []
	| [{ $?: { available: "yes" | "no"; supportedParams: string } }];

type TorznabCaps = {
	caps?: {
		searching?: [
			{
				search?: TorznabSearchTechnique;
				"tv-search"?: TorznabSearchTechnique;
				"movie-search"?: TorznabSearchTechnique;
			}
		];
	};
};

interface TorznabResult {
	guid: [string];
	title: [string];
	prowlarrindexer?: [{ _: string }];
	jackettindexer?: [{ _: string }];
	indexer?: [{ _: string }];
	link: [string];
	size: [string];
	pubDate: [string];
}

type TorznabResults = { rss?: { channel?: [] | [{ item?: TorznabResult[] }] } };

export function sanitizeUrl(url: string | URL): string {
	if (typeof url === "string") {
		url = new URL(url);
	}
	return url.origin + url.pathname;
}

export function getApikey(url: string) {
	return new URL(url).searchParams.get("apikey");
}

function parseTorznabResults(xml: TorznabResults): Candidate[] {
	const items = xml?.rss?.channel?.[0]?.item;
	if (!items || !Array.isArray(items)) {
		return [];
	}

	return items.map((item) => ({
		guid: item.guid[0],
		name: item.title[0],
		tracker:
			item?.prowlarrindexer?.[0]?._ ??
			item?.jackettindexer?.[0]?._ ??
			item?.indexer?.[0]?._ ??
			"Unknown tracker",
		link: item.link[0],
		size: Number(item.size[0]),
		pubDate: new Date(item.pubDate[0]).getTime(),
	}));
}

function findIdTokens(capTags: string | undefined): string[] | undefined {
	return capTags?.split(",").filter((token) => token.includes("id"));
}

function parseTorznabCaps(xml: TorznabCaps): Caps {
	const capsSection = xml?.caps?.searching?.[0];
	const isAvailable = (searchTechnique) =>
		searchTechnique?.[0]?.$?.available === "yes";
	const idCapNames: (keyof IdSearchCaps)[] = ["tvdbId", "tmdbId", "imdbId"];
	const movieCaps: IdSearchCaps = {
		tvdbId: false,
		tmdbId: false,
		imdbId: false,
	};
	const tvCaps: IdSearchCaps = {
		tvdbId: false,
		tmdbId: false,
		imdbId: false,
	};
	function setIdCaps(token: string[], caps: IdSearchCaps) {
		idCapNames.forEach((variableName) => {
			if (token?.includes(variableName.toLocaleLowerCase())) {
				caps[variableName] = true;
			}
		});
	}

	setIdCaps(
		findIdTokens(capsSection?.["tv-search"]?.[0]?.$?.supportedParams) || [],
		tvCaps
	);
	setIdCaps(
		findIdTokens(capsSection?.["movie-search"]?.[0]?.$?.supportedParams) ||
			[],
		movieCaps
	);

	return {
		search: Boolean(isAvailable(capsSection?.search)),
		tvSearch: Boolean(isAvailable(capsSection?.["tv-search"])),
		movieSearch: Boolean(isAvailable(capsSection?.["movie-search"])),
		movieIdSearch: movieCaps,
		tvIdSearch: tvCaps,
	};
}
async function getRelevantArrIds(
	title,
	ids: TorznabParams,
	caps: Caps
): Promise<TorznabParams> {
	const nameWithoutExtension = stripExtension(title);
	const mediaType = getTag(nameWithoutExtension);
	return mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
		? {
				tvdbid:
					caps.tvIdSearch.tvdbId && ids.tvdbid
						? ids.tvdbid
						: undefined,
				tmdbid:
					caps.tvIdSearch.tmdbId && ids.tmdbid
						? ids.tmdbid
						: undefined,
				imdbid:
					caps.tvIdSearch.tvdbId && ids.imdbid
						? ids.imdbid
						: undefined,
		  }
		: mediaType === MediaType.MOVIE
		? {
				tvdbid:
					caps.movieIdSearch.tvdbId && ids.tvdbid
						? ids.tvdbid
						: undefined,
				tmdbid:
					caps.movieIdSearch.tmdbId && ids.tmdbid
						? ids.tmdbid
						: undefined,
				imdbid:
					caps.movieIdSearch.imdbId && ids.imdbid
						? ids.imdbid
						: undefined,
		  }
		: {};
}
async function getAvailableArrIds(title: string): Promise<TorznabParams> {
	const nameWithoutExtension = stripExtension(title);
	const mediaType = getTag(nameWithoutExtension);
	try {
		const arrIdData = (await grabArrId(title, mediaType)).unwrapOrThrow();
		return mediaType === MediaType.EPISODE || mediaType === MediaType.SEASON
			? {
					tvdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.tvdbId
							: undefined,
					tmdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.tmdbId
							: undefined,
					imdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.imdbId
							: undefined,
			  }
			: mediaType === MediaType.MOVIE
			? {
					tvdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.tvdbId
							: undefined,
					tmdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.tmdbId
							: undefined,
					imdbid:
						typeof arrIdData !== "boolean"
							? arrIdData.imdbId
							: undefined,
			  }
			: {};
	} catch (e) {
		return {};
	}
}

async function createTorznabSearchQueries(
	searchee: Searchee,
	caps: Caps
): Promise<TorznabParams[]> {
	const isVideo = hasVideo(searchee);
	const nameWithoutExtension = stripExtension(searchee.name);
	const extractNumber = (str: string): number =>
		parseInt(str.match(/\d+/)![0]);
	const mediaType = getTag(nameWithoutExtension, isVideo);
	if (mediaType === MediaType.EPISODE && caps.tvSearch) {
		const match = nameWithoutExtension.match(EP_REGEX);
		return {
			t: "tvsearch",
			q: isEmptyObject(ids)
				? cleanseSeparators(match!.groups!.title)
				: undefined,
			season: match!.groups!.season
				? extractNumber(match!.groups!.season)
				: match!.groups!.year,
			ep: match!.groups!.episode
				? extractNumber(match!.groups!.episode)
				: `${match!.groups!.month}/${match!.groups!.day}`,
			...ids,
		} as const;
	} else if (mediaType === MediaType.SEASON && caps.tvSearch) {
		const match = nameWithoutExtension.match(SEASON_REGEX);
		return {
			t: "tvsearch",
			q: isEmptyObject(ids)
				? cleanseSeparators(match!.groups!.title)
				: undefined,
			season: extractNumber(match!.groups!.season),
			...ids,
		} as const;
	} else if (mediaType === MediaType.MOVIE) {
		return {
			t: "movie",
			q: isEmptyObject(ids)
				? reformatTitleForSearching(nameWithoutExtension)
				: undefined,
			...ids,
		} as const;
	} else {
		return {
			t: "search",
			q: animeQuery,
		};
	} else {
		return [
			{
				t: "search",
				q: reformatTitleForSearching(nameWithoutExtension),
			},
		] as const;
	}
}

export async function queryRssFeeds(): Promise<Candidate[]> {
	const candidatesByUrl = await makeRequests(
		await getEnabledIndexers(),
		async () => [{ t: "search", q: "" }]
	);
	return candidatesByUrl.flatMap((e) => e.candidates);
}

export async function searchTorznab(
	searchee: Searchee
): Promise<{ indexerId: number; candidates: Candidate[] }[]> {
	const { excludeRecentSearch, excludeOlder, torznab } = getRuntimeConfig();
	if (torznab.length === 0) {
		throw new Error("no indexers are available");
	}
	const enabledIndexers = await getEnabledIndexers();

	const name = searchee.name;

	// search history for name across all indexers
	const timestampDataSql = await db("searchee")
		.join("timestamp", "searchee.id", "timestamp.searchee_id")
		.join("indexer", "timestamp.indexer_id", "indexer.id")
		.whereIn(
			"indexer.id",
			enabledIndexers.map((i) => i.id)
		)
		.andWhere({ name })
		.select({
			indexerId: "indexer.id",
			firstSearched: "timestamp.first_searched",
			lastSearched: "timestamp.last_searched",
		});
	const indexersToUse = enabledIndexers.filter((indexer) => {
		const entry = timestampDataSql.find(
			(entry) => entry.indexerId === indexer.id
		);
		return (
			!entry ||
			((!excludeOlder || entry.firstSearched > nMsAgo(excludeOlder)) &&
				(!excludeRecentSearch ||
					entry.lastSearched < nMsAgo(excludeRecentSearch)))
		);
	});

	const timestampCallout = " (filtered by timestamps)";
	logger.info({
		label: Label.TORZNAB,
		message: `Searching ${indexersToUse.length} indexers for ${name}${
			indexersToUse.length < enabledIndexers.length
				? timestampCallout
				: ""
		}`,
	});	const arrIds = await getAvailableArrIds(name);

	return await makeRequests(
		indexersToUse,
		async (indexer) =>
			await createTorznabSearchQueries(searchee, arrIds {
				search: indexer.searchCap,
				tvSearch: indexer.tvSearchCap,
				movieSearch: indexer.movieSearchCap,
				tvIdSearch: JSON.parse(indexer.tvIdCaps),
				movieIdSearch: JSON.parse(indexer.movieIdCaps),
			})
	);
	
}

export async function syncWithDb() {
	const { torznab } = getRuntimeConfig();

	const dbIndexers = await db<Indexer>("indexer")
		.where({ active: true })
		.select({
			id: "id",
			url: "url",
			apikey: "apikey",
			active: "active",
			status: "status",
			retryAfter: "retry_after",
			searchCap: "search_cap",
			tvSearchCap: "tv_search_cap",
			tvIdCaps: "tv_id_caps",
			movieSearchCap: "movie_search_cap",
			movieIdCaps: "movie_id_caps",
		});

	const inConfigButNotInDb = torznab.filter(
		(configIndexer) =>
			!dbIndexers.some(
				(dbIndexer) => dbIndexer.url === sanitizeUrl(configIndexer)
			)
	);

	const inDbButNotInConfig = dbIndexers.filter(
		(dbIndexer) =>
			!torznab.some(
				(configIndexer) => sanitizeUrl(configIndexer) === dbIndexer.url
			)
	);

	const apikeyUpdates = dbIndexers.reduce<{ id: number; apikey: string }[]>(
		(acc, dbIndexer) => {
			const configIndexer = torznab.find(
				(configIndexer) => sanitizeUrl(configIndexer) === dbIndexer.url
			);
			if (
				configIndexer &&
				dbIndexer.apikey !== getApikey(configIndexer)
			) {
				acc.push({
					id: dbIndexer.id,
					apikey: getApikey(configIndexer)!,
				});
			}
			return acc;
		},
		[]
	);

	if (inDbButNotInConfig.length > 0) {
		await db("indexer")
			.whereIn(
				"url",
				inDbButNotInConfig.map((indexer) => indexer.url)
			)
			.update({ active: false });
	}

	if (inConfigButNotInDb.length > 0) {
		await db("indexer")
			.insert(
				inConfigButNotInDb.map((url) => ({
					url: sanitizeUrl(url),
					apikey: getApikey(url),
					active: true,
				}))
			)
			.onConflict("url")
			.merge(["active", "apikey"]);
	}

	await db.transaction(async (trx) => {
		for (const apikeyUpdate of apikeyUpdates) {
			await trx("indexer")
				.where({ id: apikeyUpdate.id })
				.update({ apikey: apikeyUpdate.apikey });
		}
		// drop cached UNKNOWN_ERRORs on startup
		await trx("indexer")
			.where({ status: IndexerStatus.UNKNOWN_ERROR })
			.update({ status: IndexerStatus.OK });
	});
}

function assembleUrl(
	urlStr: string,
	apikey: string,
	params: TorznabParams
): string {
	const url = new URL(urlStr);
	const searchParams = new URLSearchParams();

	searchParams.set("apikey", apikey);

	for (const [key, value] of Object.entries(params)) {
		if (value != null) searchParams.set(key, value);
	}

	url.search = searchParams.toString();
	return url.toString();
}

async function fetchCaps(indexer: {
	id: number;
	url: string;
	apikey: string;
}): Promise<Caps> {
	let response;
	try {
		response = await fetch(
			assembleUrl(indexer.url, indexer.apikey, { t: "caps" })
		);
	} catch (e) {
		const error = new Error(
			`Indexer ${indexer.url} failed to respond, check verbose logs`
		);
		logger.error(error);
		logger.debug(e);
		throw error;
	}

	const responseText = await response.text();
	if (!response.ok) {
		const error = new Error(
			`Indexer ${indexer.url} responded with code ${response.status} when fetching caps, check verbose logs`
		);
		logger.error(error);
		logger.debug(
			`Response body first 1000 characters: ${responseText.substring(
				0,
				1000
			)}`
		);
		throw error;
	}
	try {
		const parsedXml = await xml2js.parseStringPromise(responseText);

		return parseTorznabCaps(parsedXml);
	} catch (_) {
		const error = new Error(
			`Indexer ${indexer.url} responded with invalid XML when fetching caps, check verbose logs`
		);
		logger.error(error);
		logger.debug(
			`Response body first 1000 characters: ${responseText.substring(
				0,
				1000
			)}`
		);
		throw error;
	}
}

function collateOutcomes<Correlator, SuccessReturnType>(
	correlators: Correlator[],
	outcomes: PromiseSettledResult<SuccessReturnType>[]
): {
	rejected: [Correlator, PromiseRejectedResult["reason"]][];
	fulfilled: [Correlator, SuccessReturnType][];
} {
	return outcomes.reduce<{
		rejected: [Correlator, PromiseRejectedResult["reason"]][];
		fulfilled: [Correlator, SuccessReturnType][];
	}>(
		({ rejected, fulfilled }, cur, idx) => {
			if (cur.status === "rejected") {
				rejected.push([correlators[idx], cur.reason]);
			} else {
				fulfilled.push([correlators[idx], cur.value]);
			}
			return { rejected, fulfilled };
		},
		{ rejected: [], fulfilled: [] }
	);
}

async function updateCaps(
	indexers: { id: number; url: string; apikey: string }[]
): Promise<void> {
	const outcomes = await Promise.allSettled<Caps>(
		indexers.map((indexer) => fetchCaps(indexer))
	);
	const { fulfilled } = collateOutcomes<number, Caps>(
		indexers.map((i) => i.id),
		outcomes
	);

	for (const [indexerId, caps] of fulfilled) {
		await db("indexer")
			.where({ id: indexerId })
			.update({
				search_cap: caps.search,
				tv_search_cap: caps.tvSearch,
				movie_search_cap: caps.movieSearch,
				movie_id_caps: JSON.stringify(caps.movieIdSearch),
				tv_id_caps: JSON.stringify(caps.tvIdSearch),
			});
	}
}

export async function validateTorznabUrls() {
	const { torznab } = getRuntimeConfig();
	if (!torznab) return;

	const urls: URL[] = torznab.map((str) => new URL(str));
	for (const url of urls) {
		if (!url.pathname.endsWith("/api")) {
			throw new CrossSeedError(
				`Torznab url ${url} must have a path ending in /api`
			);
		}
		if (!url.searchParams.has("apikey")) {
			throw new CrossSeedError(
				`Torznab url ${url} does not specify an apikey`
			);
		}
	}
	await syncWithDb();
	const enabledIndexersWithoutCaps = await db("indexer")
		.where({
			active: true,
			search_cap: null,
			tv_search_cap: null,
			movie_search_cap: null,
		})
		.orWhere({ search_cap: false, active: true })
		.orWhere({ movie_id_caps: null, active: true })
		.orWhere({ tv_id_caps: null, active: true })
		.select({ id: "id", url: "url", apikey: "apikey" });
	await updateCaps(enabledIndexersWithoutCaps);

	const indexersWithoutSearch = await db("indexer")
		.where({ search_cap: false, active: true })
		.select({ id: "id", url: "url" });

	for (const indexer of indexersWithoutSearch) {
		logger.warn(
			`Ignoring indexer that doesn't support searching: ${indexer.url}`
		);
	}

	const indexersWithSearch = await getEnabledIndexers();

	if (indexersWithSearch.length === 0) {
		logger.warn("no working indexers available");
	}
}

async function makeRequests(
	indexers: Indexer[],
	getQueries: (indexer: Indexer) => Promise<TorznabParams[]>
): Promise<{ indexerId: number; candidates: Candidate[] }[]> {
	const { searchTimeout } = getRuntimeConfig();
	const searchUrls = await Promise.allSettled(
		indexers.flatMap(async (indexer: Indexer) =>
			(
				await getQueries(indexer)
			).map((query) => assembleUrl(indexer.url, indexer.apikey, query))
		)
	);
	searchUrls.forEach(
		(message) => void logger.verbose({ label: Label.TORZNAB, message })
	);
	const abortControllers = searchUrls.map(() => new AbortController());
	if (typeof searchTimeout === "number") {
		setTimeout(() => {
			for (const abortController of abortControllers) {
				abortController.abort();
			}
		}, searchTimeout).unref();
	}
	const resolvedUrls = await Promise.allSettled(searchUrls);
	const outcomes = await Promise.allSettled<Candidate[]>(
		resolvedUrls.map((result, i) => {
			if (
				result.status === "fulfilled" &&
				(typeof result.value === "string" ||
					result.value instanceof URL ||
					result.value instanceof Request)
			) {
				return fetch(result.value, {
					headers: { "User-Agent": USER_AGENT },
					signal: abortControllers[i].signal,
				})
					.then((response) => {
						if (!response.ok) {
							const retryAfterSeconds = Number(
								response.headers.get("Retry-After")
							);

							if (!Number.isNaN(retryAfterSeconds)) {
								updateIndexerStatus(
									response.status === 429
										? IndexerStatus.RATE_LIMITED
										: IndexerStatus.UNKNOWN_ERROR,
									Date.now() +
										ms(`${retryAfterSeconds} seconds`),
									[indexers[i].id]
								);
							} else {
								updateIndexerStatus(
									response.status === 429
										? IndexerStatus.RATE_LIMITED
										: IndexerStatus.UNKNOWN_ERROR,
									response.status === 429
										? Date.now() + ms("1 hour")
										: Date.now() + ms("10 minutes"),
									[indexers[i].id]
								);
							}
							throw new Error(
								`request failed with code: ${response.status}`
							);
						}
						return response.text();
					})
					.then(xml2js.parseStringPromise)
					.then(parseTorznabResults);
			} else {
				return [];
			}
		})
	);

	const { rejected, fulfilled } = collateOutcomes<number, Candidate[]>(
		indexers.map((indexer) => indexer.id),
		outcomes
	);

	for (const [indexerId, reason] of rejected) {
		logger.warn(
			`Failed to reach ${indexers.find((i) => i.id === indexerId)!.url}`
		);
		logger.debug(reason);
	}

	return fulfilled.map(([indexerId, results]) => ({
		indexerId,
		candidates: results,
	}));
}
