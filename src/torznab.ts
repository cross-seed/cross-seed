import ms from "ms";
import xml2js from "xml2js";
import { EP_REGEX, SEASON_REGEX, USER_AGENT } from "./constants.js";
import { getAvailableArrIds, getRelevantArrIds } from "./arr.js";
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
import { Searchee } from "./searchee.js";
import {
	getAnimeQueries,
	assembleUrl,
	cleanseSeparators,
	getApikey,
	getTag,
	MediaType,
	nMsAgo,
	reformatTitleForSearching,
	sanitizeUrl,
	stripExtension,
} from "./utils.js";
export interface TorznabCats {
	tv: boolean;
	movie: boolean;
	anime: boolean;
	audio: boolean;
	book: boolean;
}
export interface TorznabParams {
	t: "caps" | "search" | "tvsearch" | "movie";
	title?: string;
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
	tvdbId?: boolean;
	tmdbId?: boolean;
	imdbId?: boolean;
}
export interface IdSearchParams {
	tvdbid?: string;
	tmdbid?: string;
	imdbid?: string;
}
export interface Caps {
	search: boolean;
	categories: TorznabCats;
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
		categories?: object;
		searching?: [
			{
				search?: TorznabSearchTechnique;
				"tv-search"?: TorznabSearchTechnique;
				"movie-search"?: TorznabSearchTechnique;
			},
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
function parseTorznabCaps(xml: TorznabCaps): Caps {
	const categoryCaps = xml?.caps?.categories?.[0]?.category;
	const searchCaps = xml?.caps?.searching?.[0];

	const isAvailable = (section) => section?.[0]?.$.available === "yes";
	const findIdTokens = (capTags: string | undefined) =>
		capTags?.split(",").filter((token) => token.includes("id"));

	function getCatCaps(item) {
		const categoryNames: string[] = item.map((category) => category.$.name);

		function checkCategory(x: string): boolean {
			return categoryNames.some((cat) => cat.toLowerCase().includes(x));
		}
		return {
			movie: checkCategory("movie"),
			tv: checkCategory("tv"),
			anime: checkCategory("anime"),
			audio: checkCategory("audio"),
			book: checkCategory("book"),
		};
	}

	function setIdCaps(section): IdSearchCaps {
		const idCapNames: (keyof IdSearchCaps)[] = [
			"tvdbId",
			"tmdbId",
			"imdbId",
		];
		const caps: IdSearchCaps = {};
		const foundId = findIdTokens(section?.$?.supportedParams) || [];
		idCapNames.forEach((keyName) => {
			if (foundId.includes(keyName.toLocaleLowerCase())) {
				caps[keyName] = true;
			}
		});
		return caps;
	}

	return {
		search: Boolean(isAvailable(searchCaps?.search)),
		tvSearch: Boolean(isAvailable(searchCaps?.["tv-search"])),
		movieSearch: Boolean(isAvailable(searchCaps?.["movie-search"])),
		movieIdSearch: setIdCaps(searchCaps?.["movie-search"]?.[0]),
		tvIdSearch: setIdCaps(searchCaps?.["tv-search"]?.[0]),
		categories: getCatCaps(categoryCaps),
	};
}

async function createTorznabSearchQueries(
	searchee: Searchee,
	ids: IdSearchParams,
	caps: Caps,
): Promise<TorznabParams[]> {
	const nameWithoutExtension = stripExtension(searchee.name);
	const extractNumber = (str: string): number =>
		parseInt(str.match(/\d+/)![0]);
	const relevantIds = await getRelevantArrIds(searchee, ids, caps);
	const mediaType = getTag(searchee);
	if (
		mediaType === MediaType.EPISODE &&
		caps.tvSearch &&
		shouldSearchIndexer(mediaType, caps.categories)
	) {
		const match = nameWithoutExtension.match(EP_REGEX);
		return [
			{
				t: "tvsearch",
				q:
					Object.keys(relevantIds).length === 0
						? cleanseSeparators(match!.groups!.title)
						: undefined,
				season: match!.groups!.season
					? extractNumber(match!.groups!.season)
					: match!.groups!.year,
				ep: match!.groups!.episode
					? extractNumber(match!.groups!.episode)
					: `${match!.groups!.month}/${match!.groups!.day}`,
				...relevantIds,
			},
		] as const;
	} else if (
		mediaType === MediaType.SEASON &&
		caps.tvSearch &&
		shouldSearchIndexer(mediaType, caps.categories)
	) {
		const match = nameWithoutExtension.match(SEASON_REGEX);
		return [
			{
				t: "tvsearch",
				q:
					Object.keys(relevantIds).length === 0
						? cleanseSeparators(match!.groups!.title)
						: undefined,
				season: extractNumber(match!.groups!.season),
				...relevantIds,
			},
		] as const;
	} else if (
		mediaType === MediaType.MOVIE &&
		caps.movieSearch &&
		shouldSearchIndexer(mediaType, caps.categories)
	) {
		return [
			{
				t: "movie",
				q:
					Object.keys(relevantIds).length === 0
						? reformatTitleForSearching(nameWithoutExtension)
						: undefined,
				...relevantIds,
			},
		] as const;
	} else if (
		mediaType === MediaType.ANIME &&
		shouldSearchIndexer(mediaType, caps.categories)
	) {
		const animeQueries = getAnimeQueries(nameWithoutExtension);
		return animeQueries.map((animeQuery) => ({
			t: "search",
			q: animeQuery,
		}));
	} else {
		return [
			{
				t: "search",
				q: reformatTitleForSearching(nameWithoutExtension),
			},
		] as const;
	}
}
function shouldSearchIndexer(mediaType: MediaType, caps: TorznabCats) {
	switch (mediaType) {
		case MediaType.EPISODE:
		case MediaType.SEASON:
			return caps.tv;
		case MediaType.MOVIE:
			return caps.movie;
		case MediaType.ANIME:
			return caps.anime;
		case MediaType.AUDIO:
			return caps.audio;
		case MediaType.BOOK:
			return caps.book;
		case MediaType.OTHER:
			return true;
	}
}
export async function queryRssFeeds(): Promise<Candidate[]> {
	const candidatesByUrl = await makeRequests(
		await getEnabledIndexers(),
		async () => [{ t: "search", q: "" }],
	);
	return candidatesByUrl.flatMap((e) => e.candidates);
}

export async function searchTorznab(
	searchee: Searchee,
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
			enabledIndexers.map((i) => i.id),
		)
		.andWhere({ name })
		.select({
			indexerId: "indexer.id",
			firstSearched: "timestamp.first_searched",
			lastSearched: "timestamp.last_searched",
		});
	const indexersToUse = enabledIndexers.filter((indexer) => {
		const entry = timestampDataSql.find(
			(entry) => entry.indexerId === indexer.id,
		);
		return (
			!entry ||
			((!excludeOlder || entry.firstSearched > nMsAgo(excludeOlder)) &&
				(!excludeRecentSearch ||
					entry.lastSearched < nMsAgo(excludeRecentSearch)) &&
				shouldSearchIndexer(
					getTag(searchee),
					JSON.parse(indexer.categories),
				))
		);
	});

	const timeOrCatCallout = " (filtered by category/timestamps)";
	logger.info({
		label: Label.TORZNAB,
		message: `Searching ${indexersToUse.length} indexers for ${name}${
			indexersToUse.length < enabledIndexers.length
				? timeOrCatCallout
				: ""
		}`,
	});
	const searcheeIds = await getAvailableArrIds(searchee);
	return await makeRequests(indexersToUse, async (indexer) => {
		const caps = {
			search: indexer.searchCap,
			tvSearch: indexer.tvSearchCap,
			movieSearch: indexer.movieSearchCap,
			tvIdSearch: JSON.parse(indexer.tvIdCaps),
			movieIdSearch: JSON.parse(indexer.movieIdCaps),
			categories: JSON.parse(indexer.categories),
		};
		return await createTorznabSearchQueries(searchee, searcheeIds, caps);
	});
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
			categories: "cat_caps",
		});

	const inConfigButNotInDb = torznab.filter(
		(configIndexer) =>
			!dbIndexers.some(
				(dbIndexer) => dbIndexer.url === sanitizeUrl(configIndexer),
			),
	);

	const inDbButNotInConfig = dbIndexers.filter(
		(dbIndexer) =>
			!torznab.some(
				(configIndexer) => sanitizeUrl(configIndexer) === dbIndexer.url,
			),
	);

	const apikeyUpdates = dbIndexers.reduce<{ id: number; apikey: string }[]>(
		(acc, dbIndexer) => {
			const configIndexer = torznab.find(
				(configIndexer) => sanitizeUrl(configIndexer) === dbIndexer.url,
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
		[],
	);

	if (inDbButNotInConfig.length > 0) {
		await db("indexer")
			.whereIn(
				"url",
				inDbButNotInConfig.map((indexer) => indexer.url),
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
				})),
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

async function fetchCaps(indexer: {
	id: number;
	url: string;
	apikey: string;
}): Promise<Caps> {
	let response;
	try {
		response = await fetch(
			assembleUrl(indexer.url, indexer.apikey, { t: "caps" }),
		);
	} catch (e) {
		const error = new Error(
			`Indexer ${indexer.url} failed to respond, check verbose logs`,
		);
		logger.error(error);
		logger.debug(e);
		throw error;
	}

	const responseText = await response.text();
	if (!response.ok) {
		const error = new Error(
			`Indexer ${indexer.url} responded with code ${response.status} when fetching caps, check verbose logs`,
		);
		logger.error(error);
		logger.debug(
			`Response body first 1000 characters: ${responseText.substring(
				0,
				1000,
			)}`,
		);
		throw error;
	}
	try {
		const parsedXml = await xml2js.parseStringPromise(responseText);
		return parseTorznabCaps(parsedXml);
	} catch (_) {
		const error = new Error(
			`Indexer ${indexer.url} responded with invalid XML when fetching caps, check verbose logs`,
		);
		logger.error(error);
		logger.debug(
			`Response body first 1000 characters: ${responseText.substring(
				0,
				1000,
			)}`,
		);
		throw error;
	}
}

function collateOutcomes<Correlator, SuccessReturnType>(
	correlators: Correlator[],
	outcomes: PromiseSettledResult<SuccessReturnType>[],
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
		{ rejected: [], fulfilled: [] },
	);
}

async function updateCaps(
	indexers: { id: number; url: string; apikey: string }[],
): Promise<void> {
	const outcomes = await Promise.allSettled<Caps>(
		indexers.map((indexer) => fetchCaps(indexer)),
	);
	const { fulfilled } = collateOutcomes<number, Caps>(
		indexers.map((i) => i.id),
		outcomes,
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
				cat_caps: JSON.stringify(caps.categories),
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
				`Torznab url ${url} must have a path ending in /api`,
			);
		}
		if (!url.searchParams.has("apikey")) {
			throw new CrossSeedError(
				`Torznab url ${url} does not specify an apikey`,
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
		.orWhere({ cat_caps: null, active: true })
		.select({ id: "id", url: "url", apikey: "apikey" });
	await updateCaps(enabledIndexersWithoutCaps);

	const indexersWithoutSearch = await db("indexer")
		.where({ search_cap: false, active: true })
		.select({ id: "id", url: "url" });

	for (const indexer of indexersWithoutSearch) {
		logger.warn(
			`Ignoring indexer that doesn't support searching: ${indexer.url}`,
		);
	}

	const indexersWithSearch = await getEnabledIndexers();

	if (indexersWithSearch.length === 0) {
		logger.warn("no working indexers available");
	}
}

async function makeRequests(
	indexers: Indexer[],
	getQueries: (indexer: Indexer) => Promise<TorznabParams[]>,
): Promise<{ indexerId: number; candidates: Candidate[] }[]> {
	const { searchTimeout } = getRuntimeConfig();
	const searchUrls = await Promise.all(
		indexers.flatMap(async (indexer: Indexer) =>
			(await getQueries(indexer)).map((query) =>
				assembleUrl(indexer.url, indexer.apikey, query),
			),
		),
	);
	searchUrls.forEach(
		(message) => void logger.verbose({ label: Label.TORZNAB, message }),
	);
	const abortControllers = searchUrls.map(() => new AbortController());
	if (typeof searchTimeout === "number") {
		setTimeout(() => {
			for (const abortController of abortControllers) {
				abortController.abort();
			}
		}, searchTimeout).unref();
	}
	const outcomes = await Promise.allSettled<Candidate[]>(
		searchUrls.map((url, i) => {
			return fetch(url[0], {
				headers: { "User-Agent": USER_AGENT },
				signal: abortControllers[i].signal,
			})
				.then((response) => {
					if (!response.ok) {
						const retryAfterSeconds = Number(
							response.headers.get("Retry-After"),
						);

						if (!Number.isNaN(retryAfterSeconds)) {
							updateIndexerStatus(
								response.status === 429
									? IndexerStatus.RATE_LIMITED
									: IndexerStatus.UNKNOWN_ERROR,
								Date.now() + ms(`${retryAfterSeconds} seconds`),
								[indexers[i].id],
							);
						} else {
							updateIndexerStatus(
								response.status === 429
									? IndexerStatus.RATE_LIMITED
									: IndexerStatus.UNKNOWN_ERROR,
								response.status === 429
									? Date.now() + ms("1 hour")
									: Date.now() + ms("10 minutes"),
								[indexers[i].id],
							);
						}
						throw new Error(
							`request failed with code: ${response.status}`,
						);
					}
					return response.text();
				})
				.then(xml2js.parseStringPromise)
				.then(parseTorznabResults);
		}),
	);

	const { rejected, fulfilled } = collateOutcomes<number, Candidate[]>(
		indexers.map((indexer) => indexer.id),
		outcomes,
	);

	for (const [indexerId, reason] of rejected) {
		logger.warn(
			`Failed to reach ${indexers.find((i) => i.id === indexerId)!.url}`,
		);
		logger.debug(reason);
	}

	return fulfilled.map(([indexerId, results]) => ({
		indexerId,
		candidates: results,
	}));
}
export { sanitizeUrl, getApikey };
