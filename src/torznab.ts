import chalk from "chalk";
import ms from "ms";
import { inspect } from "util";
import xml2js from "xml2js";
import {
	arrIdsEqual,
	ExternalIds,
	formatFoundIds,
	getRelevantArrIds,
	ParsedMedia,
	scanAllArrsForMedia,
} from "./arr.js";
import {
	CALIBRE_INDEXNUM_REGEX,
	EP_REGEX,
	SEASON_REGEX,
	UNKNOWN_TRACKER,
	USER_AGENT,
} from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import {
	ALL_CAPS,
	Caps,
	getAllIndexers,
	getEnabledIndexers,
	IdSearchCaps,
	Indexer,
	IndexerCategories,
	IndexerStatus,
	updateIndexerCapsById,
	updateIndexerStatus,
} from "./indexers.js";
import { Label, logger, logOnce } from "./logger.js";
import { Candidate } from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee, SearcheeWithLabel } from "./searchee.js";
import {
	cleanTitle,
	combineAsyncIterables,
	extractInt,
	formatAsList,
	getAnimeQueries,
	getApikey,
	getLogString,
	getMediaType,
	isTruthy,
	MediaType,
	nMsAgo,
	reformatTitleForSearching,
	sanitizeUrl,
	stripExtension,
	stripMetaFromName,
} from "./utils.js";

export interface IdSearchParams {
	tvdbid?: string;
	tmdbid?: string;
	imdbid?: string;
	tvmazeid?: string;
}

interface Query extends IdSearchParams {
	t: "caps" | "search" | "tvsearch" | "movie";
	q?: string;
	limit?: number;
	offset?: number;
	season?: number | string;
	ep?: number | string;
}

export interface TorznabRequest {
	indexerId: number;
	baseUrl: string;
	apikey: string;
	query: Query;
}

type TorznabSearchTechnique =
	| []
	| [{ $: { available: "yes" | "no"; supportedParams: string } }];
type LimitXmlElement = { $: { default: string; max: string } };
type CategoryXmlElement = { $: { id: string; name: string } };
type TorznabCaps = {
	caps?: {
		limits: LimitXmlElement[];
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
export type CachedSearch = {
	q: string | null;
	indexerCandidates: IndexerCandidates[];
	ids?: ExternalIds;
};

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
	const limits = xml?.caps?.limits?.map((limit) => ({
		default: parseInt(limit.$.default),
		max: parseInt(limit.$.max),
	}))[0] ?? { default: 100, max: 100 };

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
			tvMazeId: supportedIds.includes("tvmazeid"),
		};
	}

	const categoryCaps = xml?.caps?.categories?.[0]?.category;

	function getCatCaps(item: CategoryXmlElement[] | undefined) {
		const categories = (item ?? []).map((cat) => ({
			id: parseInt(cat.$.id),
			name: cat.$.name.toLowerCase(),
		}));

		const caps = {
			movie: false,
			tv: false,
			anime: false,
			xxx: false,
			audio: false,
			book: false,
			additional: false,
		};
		const keys = Object.keys(caps);
		keys.splice(keys.indexOf("additional"), 1);
		for (const { id, name } of categories) {
			let isAdditional = true;
			for (const cap of keys) {
				if (name.includes(cap)) {
					caps[cap] = true;
					isAdditional = false;
				}
			}
			if (isAdditional && id < 100000 && (id < 8000 || id > 8999)) {
				caps.additional = true;
			}
		}
		return caps;
	}

	return {
		search: Boolean(isAvailable(searchingSection?.search)),
		tvSearch: Boolean(isAvailable(searchingSection?.["tv-search"])),
		movieSearch: Boolean(isAvailable(searchingSection?.["movie-search"])),
		movieIdSearch: getSupportedIds(searchingSection?.["movie-search"]),
		tvIdSearch: getSupportedIds(searchingSection?.["tv-search"]),
		categories: getCatCaps(categoryCaps),
		limits,
	};
}

async function createTorznabSearchQueries(
	searchee: Searchee,
	mediaType: MediaType,
	caps: Caps,
	parsedMedia?: ParsedMedia,
): Promise<Query[]> {
	const stem = stripExtension(searchee.title);
	const relevantIds: IdSearchParams = parsedMedia
		? await getRelevantArrIds(caps, parsedMedia)
		: {};
	const useIds = Object.values(relevantIds).some(isTruthy);
	if (mediaType === MediaType.EPISODE && caps.tvSearch) {
		const match = stem.match(EP_REGEX);
		const groups = match!.groups!;
		return [
			{
				t: "tvsearch",
				q: useIds ? undefined : reformatTitleForSearching(stem),
				season: groups.season ? extractInt(groups.season) : groups.year,
				ep: groups.episode
					? extractInt(groups.episode)
					: `${groups.month}/${groups.day}`,
				...relevantIds,
			},
		] as const;
	} else if (mediaType === MediaType.SEASON && caps.tvSearch) {
		const match = stem.match(SEASON_REGEX);
		const groups = match!.groups!;
		return [
			{
				t: "tvsearch",
				q: useIds ? undefined : reformatTitleForSearching(stem),
				season: extractInt(groups.season),
				...relevantIds,
			},
		] as const;
	} else if (mediaType === MediaType.MOVIE && caps.movieSearch) {
		return [
			{
				t: "movie",
				q: useIds ? undefined : reformatTitleForSearching(stem),
				...relevantIds,
			},
		] as const;
	}
	if (useIds && caps.tvSearch && parsedMedia?.series) {
		const eps = parsedMedia.episodes;
		const season = eps.length > 0 ? eps[0].seasonNumber : undefined;
		const ep = eps.length === 1 ? eps[0].episodeNumber : undefined;
		return [
			{ t: "tvsearch", q: undefined, season, ep, ...relevantIds },
		] as const;
	} else if (useIds && caps.movieSearch && parsedMedia?.movie) {
		return [{ t: "movie", q: undefined, ...relevantIds }] as const;
	} else if (mediaType === MediaType.ANIME) {
		return getAnimeQueries(stem).map((animeQuery) => ({
			t: "search",
			q: animeQuery,
		}));
	} else if (mediaType === MediaType.VIDEO) {
		return [
			{
				t: "search",
				q: cleanTitle(stripMetaFromName(stem)),
			},
		] as const;
	} else if (mediaType === MediaType.BOOK && searchee.path) {
		return [
			{
				t: "search",
				q: cleanTitle(stem.replace(CALIBRE_INDEXNUM_REGEX, "")),
			},
		] as const;
	}
	return [
		{
			t: "search",
			q: cleanTitle(stem),
		},
	] as const;
}

export async function getSearchString(searchee: Searchee): Promise<string> {
	const mediaType = getMediaType(searchee);
	const params = (
		await createTorznabSearchQueries(searchee, mediaType, ALL_CAPS)
	)[0];
	const season = params.season !== undefined ? `.S${params.season}` : "";
	const ep = params.ep !== undefined ? `.E${params.ep}` : "";
	return `${params.q}${season}${ep}`.toLowerCase();
}

/**
 * Only for testing purposes. (createTorznabSearchQueries now accepts searchee
 * instead of stem (title))
 *
 * Logs the queries that would be sent to indexers for id and non-id searches.
 * Ensure that item exists in your arr for the id search example.
 * Ensure mediaType is what cross-seed would actually parse the item as.
 */
export async function logQueries(
	searcheeTitle: string,
	mediaType: MediaType,
): Promise<void> {
	const stem = stripExtension(searcheeTitle);
	logger.info(
		// @ts-expect-error needs conversion to use searchee instead of stem
		`RAW: ${inspect(await createTorznabSearchQueries(stem, mediaType, ALL_CAPS))}`,
	);
	const res = await scanAllArrsForMedia(searcheeTitle, mediaType);
	const parsedMedia = res.isOk() ? res.unwrap() : undefined;
	logger.info(
		// @ts-expect-error needs conversion to use searchee instead of stem
		`ID: ${inspect(await createTorznabSearchQueries(stem, mediaType, ALL_CAPS, parsedMedia))}`,
	);
}

export function indexerDoesSupportMediaType(
	mediaType: MediaType,
	caps: IndexerCategories,
) {
	switch (mediaType) {
		case MediaType.EPISODE:
		case MediaType.SEASON:
			return caps.tv;
		case MediaType.MOVIE:
			return caps.movie;
		case MediaType.ANIME:
		case MediaType.VIDEO:
			return caps.movie || caps.tv || caps.anime || caps.xxx;
		case MediaType.AUDIO:
			return caps.audio;
		case MediaType.BOOK:
			return caps.book;
		case MediaType.OTHER:
			return caps.additional;
	}
}

export async function* rssPager(
	indexer: Indexer,
	pageBackUntil: number,
): AsyncGenerator<Candidate, void, undefined> {
	let earliestSeen = Infinity;
	const limit = indexer.limits.max;
	for (let i = 0; i < 10; i++) {
		let currentPageCandidates: Candidate[];

		try {
			currentPageCandidates = await makeRequest({
				indexerId: indexer.id,
				baseUrl: indexer.url,
				apikey: indexer.apikey,
				query: { t: "search", q: "", limit, offset: i * limit },
			});
		} catch (e) {
			logger.error({
				label: Label.TORZNAB,
				message: `Paging indexer ${indexer.id} stopped: request failed for page ${i + 1}`,
			});
			logger.debug(e);
			return;
		}

		const allNewPubDates = currentPageCandidates.map((c) => c.pubDate);
		const currentPageEarliest = Math.min(...allNewPubDates);
		const currentPageLatest = Math.max(...allNewPubDates);

		const newCandidates = currentPageCandidates.filter(
			(c) => c.pubDate < earliestSeen && c.pubDate >= pageBackUntil,
		);

		if (currentPageLatest > Date.now() + ms("10 minutes")) {
			logOnce(
				`timezone-issues-${indexer.id}`,
				() =>
					void logger.warn(
						`Indexer ${indexer.url} reported releases in the future. Its timezone may be misconfigured.`,
					),
				ms("10 minutes"),
			);
		}

		if (!newCandidates.length) {
			logger.verbose({
				label: Label.TORZNAB,
				message: `Paging indexer ${indexer.id} stopped: nothing new in page ${i + 1}`,
			});
			return;
		}

		logger.verbose({
			label: Label.TORZNAB,
			message: `${newCandidates.length} new candidates on indexer ${indexer.id} page ${i + 1}`,
		});

		// yield each new candidate
		yield* newCandidates;

		earliestSeen = Math.min(earliestSeen, currentPageEarliest);
	}
	logger.verbose({
		label: Label.TORZNAB,
		message: `Paging indexer ${indexer.url} stopped: reached 10 pages`,
	});
}

export async function* queryRssFeeds(
	pageBackUntil: number,
): AsyncGenerator<Candidate> {
	const indexers = await getEnabledIndexers();
	yield* combineAsyncIterables(
		indexers.map((indexer) => rssPager(indexer, pageBackUntil)),
	);
}

export async function searchTorznab(
	searchee: SearcheeWithLabel,
	cachedSearch: CachedSearch,
	progress: string,
): Promise<IndexerCandidates[]> {
	const { torznab } = getRuntimeConfig();
	if (torznab.length === 0) {
		throw new Error("no indexers are available");
	}

	const mediaType = getMediaType(searchee);
	const { indexersToSearch, parsedMedia } = await getAndLogIndexers(
		searchee,
		cachedSearch,
		mediaType,
		progress,
	);
	const indexerCandidates = await makeRequests(
		indexersToSearch,
		async (indexer): Promise<Query[]> => {
			const caps = {
				search: indexer.searchCap,
				tvSearch: indexer.tvSearchCap,
				movieSearch: indexer.movieSearchCap,
				tvIdSearch: indexer.tvIdCaps,
				movieIdSearch: indexer.movieIdCaps,
				categories: indexer.categories,
				limits: indexer.limits,
			};
			return await createTorznabSearchQueries(
				searchee,
				mediaType,
				caps,
				parsedMedia,
			);
		},
	);
	return [...cachedSearch.indexerCandidates, ...indexerCandidates];
}

export async function syncWithDb() {
	const { torznab } = getRuntimeConfig();

	const dbIndexers = await getAllIndexers();

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

export function assembleUrl(
	baseUrl: string,
	apikey: string,
	params: Query,
): string {
	const url = new URL(baseUrl);
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
	let response: Response;
	try {
		response = await fetch(
			assembleUrl(indexer.url, indexer.apikey, { t: "caps" }),
			{ signal: AbortSignal.timeout(ms("10 seconds")) },
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

export async function updateCaps(): Promise<void> {
	const indexers = await getAllIndexers();
	const outcomes = await Promise.allSettled<Caps>(
		indexers.map((indexer) => fetchCaps(indexer)),
	);
	const { fulfilled } = collateOutcomes<number, Caps>(
		indexers.map((i) => i.id),
		outcomes,
	);
	for (const [indexerId, caps] of fulfilled) {
		await updateIndexerCapsById(indexerId, caps);
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
	await updateCaps();

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

/**
 * Snooze indexers based on the response headers and status code.
 * specifically for a search, probably not applicable to a caps fetch.
 */
async function onResponseNotOk(response: Response, indexerId: number) {
	const retryAfterSeconds = Number(response.headers.get("Retry-After"));

	const retryAfter = !Number.isNaN(retryAfterSeconds)
		? Date.now() + ms(`${retryAfterSeconds} seconds`)
		: response.status === 429
			? Date.now() + ms("1 hour")
			: Date.now() + ms("10 minutes");

	await updateIndexerStatus(
		response.status === 429
			? IndexerStatus.RATE_LIMITED
			: IndexerStatus.UNKNOWN_ERROR,
		retryAfter,
		[indexerId],
	);
}

async function makeRequest(request: TorznabRequest): Promise<Candidate[]> {
	const { searchTimeout } = getRuntimeConfig();
	const url = assembleUrl(request.baseUrl, request.apikey, request.query);
	const abortSignal =
		typeof searchTimeout === "number"
			? AbortSignal.timeout(searchTimeout)
			: undefined;
	logger.verbose({
		label: Label.TORZNAB,
		message: `Querying indexer ${request.indexerId} at ${request.baseUrl} with ${inspect(request.query)}`,
	});
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
		signal: abortSignal,
	});
	if (!response.ok) {
		await onResponseNotOk(response, request.indexerId);
		throw new Error(`request failed with code: ${response.status}`);
	}
	const xml = await response.text();
	const torznabResults: unknown = await xml2js.parseStringPromise(xml);
	return parseTorznabResults(torznabResults as TorznabResults);
}

async function makeRequests(
	indexers: Indexer[],
	getQueriesForIndexer: (indexer: Indexer) => Promise<Query[]>,
): Promise<IndexerCandidates[]> {
	const requests: TorznabRequest[] = [];
	for (const indexer of indexers) {
		const queries = await getQueriesForIndexer(indexer);
		requests.push(
			...queries.map((query) => ({
				indexerId: indexer.id,
				baseUrl: indexer.url,
				apikey: indexer.apikey,
				query,
			})),
		);
	}

	const outcomes = await Promise.allSettled<Candidate[]>(
		requests.map(makeRequest),
	);

	const { rejected, fulfilled } = collateOutcomes<number, Candidate[]>(
		requests.map((request) => request.indexerId),
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
	searchee: SearcheeWithLabel,
	cachedSearch: CachedSearch,
	mediaType: MediaType,
	progress: string,
): Promise<{ indexersToSearch: Indexer[]; parsedMedia?: ParsedMedia }> {
	const { excludeRecentSearch, excludeOlder } = getRuntimeConfig();
	const searcheeLog = getLogString(searchee, chalk.bold.white);
	const mediaTypeLog = chalk.white(mediaType.toUpperCase());

	const enabledIndexers = await getEnabledIndexers();

	// search history for name across all indexers
	const name = searchee.title;
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

	const skipBefore =
		searchee.label !== Label.WEBHOOK && excludeOlder
			? nMsAgo(excludeOlder)
			: Number.NEGATIVE_INFINITY;
	const skipAfter =
		searchee.label !== Label.WEBHOOK && excludeRecentSearch
			? nMsAgo(excludeRecentSearch)
			: Number.POSITIVE_INFINITY;
	const timeFilteredIndexers = enabledIndexers.filter((indexer) => {
		const entry = timestampDataSql.find(
			(entry) => entry.indexerId === indexer.id,
		);
		if (!entry) return true;
		if (entry.firstSearched < skipBefore) return false;
		if (entry.lastSearched > skipAfter) return false;
		return true;
	});

	const indexersToUse = timeFilteredIndexers.filter((indexer) => {
		return indexerDoesSupportMediaType(mediaType, indexer.categories);
	});

	// Invalidate cache if searchStr or ids is different
	let shouldScanArr = true;
	let parsedMedia: ParsedMedia | undefined;
	const searchStr = await getSearchString(searchee);
	if (cachedSearch.q === searchStr) {
		shouldScanArr = false;
		const res = await scanAllArrsForMedia(name, mediaType);
		parsedMedia = res.isOk() ? res.unwrap() : undefined;
		const ids = parsedMedia?.movie ?? parsedMedia?.series;
		if (!arrIdsEqual(ids, cachedSearch.ids)) {
			cachedSearch.indexerCandidates.length = 0;
			cachedSearch.ids = ids;
		}
	} else {
		cachedSearch.q = searchStr;
		cachedSearch.indexerCandidates.length = 0;
		cachedSearch.ids = undefined; // Don't prematurely get ids if skipping
	}
	const indexersToSearch = indexersToUse.filter((indexer) => {
		return !cachedSearch.indexerCandidates.some(
			(candidates) => candidates.indexerId === indexer.id,
		);
	});

	const filteringCauses = [
		enabledIndexers.length > timeFilteredIndexers.length && "timestamps",
		timeFilteredIndexers.length > indexersToUse.length && "category",
	].filter(isTruthy);
	const reasonStr = filteringCauses.length
		? ` (filtered by ${formatAsList(filteringCauses, { sort: true })})`
		: "";
	if (!indexersToSearch.length && !cachedSearch.indexerCandidates.length) {
		cachedSearch.q = null; // Won't scan arrs for multiple skips in a row
		logger.info({
			label: searchee.label,
			message: `${progress}Skipped searching on indexers for ${searcheeLog}${reasonStr} | MediaType: ${mediaTypeLog} | IDs: N/A`,
		});
		return { indexersToSearch };
	}

	if (shouldScanArr) {
		const res = await scanAllArrsForMedia(name, mediaType);
		parsedMedia = res.isOk() ? res.unwrap() : undefined;
		cachedSearch.ids = parsedMedia?.movie ?? parsedMedia?.series;
	}
	const idsStr = cachedSearch.ids ? formatFoundIds(cachedSearch.ids) : "NONE";

	logger.info({
		label: searchee.label,
		message: `${progress}Searching for ${searcheeLog} | MediaType: ${mediaTypeLog} | IDs: ${idsStr}`,
	});

	return { indexersToSearch, parsedMedia };
}
