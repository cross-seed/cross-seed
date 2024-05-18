import ms from "ms";
import xml2js from "xml2js";
import { getAvailableArrIds, getRelevantArrIds, ExternalIds } from "./arr.js";
import {
	EP_REGEX,
	SEASON_REGEX,
	UNKNOWN_TRACKER,
	USER_AGENT,
} from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import {
	getAllIndexers,
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
	assembleUrl,
	cleanseSeparators,
	getAnimeQueries,
	getApikey,
	getNewestFileAge,
	getMediaType,
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

export interface IdSearchParams {
	tvdbid?: string;
	tmdbid?: string;
	imdbid?: string;
}

export interface TorznabParams extends IdSearchParams {
	t: "caps" | "search" | "tvsearch" | "movie";
	q?: string;
	limit?: number;
	apikey?: string;
	season?: number | string;
	ep?: number | string;
}

export interface IdSearchCaps {
	tvdbId?: boolean;
	tmdbId?: boolean;
	imdbId?: boolean;
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
	| [{ $: { available: "yes" | "no"; supportedParams: string } }];

type CategoryXmlElement = { $: { id: string; name: string } };
type TorznabCaps = {
	caps?: {
		categories: { category: CategoryXmlElement[] }[];
		searching: [
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

export type IndexerCandidates = { indexerId: number; candidates: Candidate[] };

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
			UNKNOWN_TRACKER,
		link: item.link[0],
		size: Number(item.size[0]),
		pubDate: new Date(item.pubDate[0]).getTime(),
	}));
}

function parseTorznabCaps(xml: TorznabCaps): Caps {
	const searchingSection = xml?.caps?.searching?.[0];
	const isAvailable = (searchTechnique: TorznabSearchTechnique | undefined) =>
		searchTechnique?.[0]?.$?.available === "yes";

	function getSupportedIds(
		searchTechnique: TorznabSearchTechnique | undefined,
	): IdSearchCaps {
		const supportedParamsStr = searchTechnique?.[0]?.$?.supportedParams;
		const supportedIds =
			supportedParamsStr
				?.split(",")
				?.filter((token) => token.includes("id")) ?? [];

		return {
			tvdbId: supportedIds.includes("tvdbid"),
			tmdbId: supportedIds.includes("tmdbid"),
			imdbId: supportedIds.includes("imdbid"),
		};
	}

	const categoryCaps = xml?.caps?.categories?.[0]?.category;

	function getCatCaps(item: CategoryXmlElement[] | undefined) {
		const categoryNames: string[] = (item ?? []).map(
			(category) => category.$.name,
		);

		function indexerDoesSupportCat(category: string): boolean {
			return categoryNames.some((cat) =>
				cat.toLowerCase().includes(category),
			);
		}
		return {
			movie: indexerDoesSupportCat("movie"),
			tv: indexerDoesSupportCat("tv"),
			anime: indexerDoesSupportCat("anime"),
			audio: indexerDoesSupportCat("audio"),
			book: indexerDoesSupportCat("book"),
		};
	}

	return {
		search: Boolean(isAvailable(searchingSection?.search)),
		tvSearch: Boolean(isAvailable(searchingSection?.["tv-search"])),
		movieSearch: Boolean(isAvailable(searchingSection?.["movie-search"])),
		movieIdSearch: getSupportedIds(searchingSection?.["movie-search"]),
		tvIdSearch: getSupportedIds(searchingSection?.["tv-search"]),
		categories: getCatCaps(categoryCaps),
	};
}

async function createTorznabSearchQueries(
	searchee: Searchee,
	ids?: ExternalIds,
	caps?: Caps,
): Promise<TorznabParams[]> {
	const nameWithoutExtension = stripExtension(searchee.name);
	const extractNumber = (str: string): number =>
		parseInt(str.match(/\d+/)![0]);
	let relevantIds: IdSearchParams = {};
	if (ids && caps) {
		relevantIds = await getRelevantArrIds(searchee, ids, caps);
	}
	const shouldUseIdSearch = Object.values(relevantIds).some((id) => id);
	const mediaType = getMediaType(searchee);
	if (mediaType === MediaType.EPISODE && (!caps || caps.tvSearch)) {
		const match = nameWithoutExtension.match(EP_REGEX);
		const groups = match!.groups!;
		return [
			{
				t: "tvsearch",
				q: shouldUseIdSearch
					? undefined
					: cleanseSeparators(groups.title),
				season: groups.season
					? extractNumber(groups.season)
					: groups.year,
				ep: groups.episode
					? extractNumber(groups.episode)
					: `${groups.month}/${groups.day}`,
				...relevantIds,
			},
		] as const;
	} else if (mediaType === MediaType.SEASON && (!caps || caps.tvSearch)) {
		const match = nameWithoutExtension.match(SEASON_REGEX);
		const groups = match!.groups!;
		return [
			{
				t: "tvsearch",
				q: shouldUseIdSearch
					? undefined
					: cleanseSeparators(groups.title),
				season: extractNumber(groups.season),
				...relevantIds,
			},
		] as const;
	} else if (mediaType === MediaType.MOVIE && (!caps || caps.movieSearch)) {
		return [
			{
				t: "movie",
				q: shouldUseIdSearch
					? undefined
					: reformatTitleForSearching(nameWithoutExtension),
				...relevantIds,
			},
		] as const;
	} else if (mediaType === MediaType.ANIME) {
		const animeQueries = getAnimeQueries(nameWithoutExtension);
		return animeQueries.length > 0
			? animeQueries.map((animeQuery) => ({
					t: "search",
					q: animeQuery,
				}))
			: ([
					{
						t: "search",
						q: reformatTitleForSearching(nameWithoutExtension),
					},
				] as const);
	} else {
		return [
			{
				t: "search",
				q: reformatTitleForSearching(nameWithoutExtension),
			},
		] as const;
	}
}

export async function getSearchString(searchee: Searchee): Promise<string> {
	const params = (await createTorznabSearchQueries(searchee))[0];
	const season = params.season !== undefined ? `.S${params.season}` : "";
	const ep = params.ep !== undefined ? `.E${params.ep}` : "";
	return `${params.q}${season}${ep}`.toLowerCase();
}

export function indexerDoesSupportMediaType(
	mediaType: MediaType,
	caps: TorznabCats,
) {
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
	prevCandidates: Map<string, IndexerCandidates[]>,
	searchStr: string,
): Promise<IndexerCandidates[]> {
	const { torznab } = getRuntimeConfig();
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
	try {
		const indexersToSearch = await getAndLogIndexers(
			enabledIndexers,
			timestampDataSql,
			name,
			searchee,
			prevCandidates,
			searchStr,
		);

		const searcheeIds =
			indexersToSearch.length > 0
				? await getAvailableArrIds(searchee)
				: {};
		const indexerCandidates = await makeRequests(
			indexersToSearch,
			async (indexer) => {
				const caps = {
					search: indexer.searchCap,
					tvSearch: indexer.tvSearchCap,
					movieSearch: indexer.movieSearchCap,
					tvIdSearch: JSON.parse(indexer.tvIdCaps),
					movieIdSearch: JSON.parse(indexer.movieIdCaps),
					categories: JSON.parse(indexer.categories),
				};
				return await createTorznabSearchQueries(
					searchee,
					searcheeIds,
					caps,
				);
			},
		);
		return [...(prevCandidates.get(searchStr) ?? []), ...indexerCandidates];
	} catch (e) {
		throw new Error(e);
	}
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
		logger.error(error.message);
		logger.debug(e);
		throw error;
	}

	const responseText = await response.text();
	if (!response.ok) {
		const error = new Error(
			`Indexer ${indexer.url} responded with code ${response.status} when fetching caps, check verbose logs`,
		);
		logger.error(error.message);
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
		logger.error(error.message);
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
	const allIndexers = await getAllIndexers();
	await updateCaps(allIndexers);

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
): Promise<IndexerCandidates[]> {
	const { searchTimeout } = getRuntimeConfig();
	const searchUrls = await Promise.all(
		indexers.flatMap(async (indexer: Indexer) =>
			(await getQueries(indexer)).map((query) =>
				assembleUrl(indexer.url, indexer.apikey, query),
			),
		),
	).then((urls) => urls.flat());
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
		searchUrls.map((url, i) =>
			fetch(url, {
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
				.then(parseTorznabResults),
		),
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
async function getAndLogIndexers(
	enabledIndexers: Indexer[],
	timestampDataSql,
	name: string,
	searchee: Searchee,
	prevCandidates: Map<string, IndexerCandidates[]>,
	searchStr: string,
) {
	const { excludeRecentSearch, excludeOlder, seasonFromEpisodes } =
		getRuntimeConfig();
	const mediaType = getMediaType(searchee);
	const mediaTypeStr = mediaType.toUpperCase();

	const indexersToUseByTimestamp = enabledIndexers.filter((indexer) => {
		const entry = timestampDataSql.find(
			(entry) => entry.indexerId === indexer.id,
		);
		if (!entry) {
			return true;
		}
		if (
			seasonFromEpisodes &&
			!searchee.infoHash &&
			!searchee.path &&
			entry.lastSearched < getNewestFileAge(searchee)
		) {
			return true;
		}
		return (
			(!excludeOlder || entry.firstSearched > nMsAgo(excludeOlder)) &&
			(!excludeRecentSearch ||
				entry.lastSearched < nMsAgo(excludeRecentSearch))
		);
	});

	const indexersToUse = indexersToUseByTimestamp.filter((indexer) => {
		return indexerDoesSupportMediaType(
			mediaType,
			JSON.parse(indexer.categories),
		);
	});
	const skippingSearching = (reason: string) =>
		`(${mediaTypeStr}) Skipped searching on indexers for ${name} ${reason}`;

	let skippingIndexersCallout =
		enabledIndexers.length > indexersToUse.length ? " (filtered by " : "";

	if (enabledIndexers.length > indexersToUseByTimestamp.length) {
		skippingIndexersCallout +=
			indexersToUseByTimestamp.length === indexersToUse.length
				? "timestamps)"
				: "timestamps ";
	}
	if (indexersToUseByTimestamp.length > indexersToUse.length) {
		skippingIndexersCallout +=
			enabledIndexers.length === indexersToUseByTimestamp.length
				? "supported category)"
				: "and supported category)";
	}

	// Invalidate cache if unrelated searchee
	if (!prevCandidates.has(searchStr)) {
		prevCandidates.clear();
	}
	const cachedCandidates = prevCandidates.get(searchStr) ?? [];
	const indexersToSearch = indexersToUse.filter((indexer) => {
		return !cachedCandidates.some(
			(candidates) => candidates.indexerId === indexer.id,
		);
	});

	if (indexersToSearch.length === 0 && cachedCandidates.length === 0) {
		logger.info({
			label: Label.TORZNAB,
			message: `${skippingSearching(skippingIndexersCallout)}`,
		});
		throw new Error("SKIPPED");
	}

	const skippingIndexers = `(${mediaTypeStr}) Using ${indexersToSearch.length}|${cachedCandidates.length} indexers by search|cache for ${name}${skippingIndexersCallout}`;

	logger.info({
		label: Label.TORZNAB,
		message: skippingIndexers,
	});

	return indexersToSearch;
}
export { sanitizeUrl, getApikey };
