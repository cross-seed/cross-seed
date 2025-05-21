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
	MediaType,
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
	IndexerStatus,
	updateIndexerCapsById,
	updateIndexerStatus,
} from "./indexers.js";
import { Label, logger } from "./logger.js";
import { Candidate, CandidateWithIndexerId } from "./pipeline.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import {
	getMediaType,
	getSearcheeNewestFileAge,
	Searchee,
	SearcheeWithLabel,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import {
	cleanTitle,
	comparing,
	extractInt,
	formatAsList,
	getAnimeQueries,
	getApikey,
	getLogString,
	humanReadableDate,
	isTruthy,
	nMsAgo,
	reformatTitleForSearching,
	sanitizeUrl,
	stripExtension,
	stripMetaFromName,
	wait,
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

interface TorznabRequest {
	indexerId: number;
	name: string | null;
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
				"music-search"?: TorznabSearchTechnique;
				"audio-search"?: TorznabSearchTechnique;
				"book-search"?: TorznabSearchTechnique;
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

export type IndexerCandidates = {
	indexerId: number;
	candidates: CandidateWithIndexerId[];
};
export type CachedSearch = {
	q: string | null;
	indexerCandidates: IndexerCandidates[];
	lastSearch: number;
	ids?: ExternalIds;
};

function parseTorznabResults(
	xml: TorznabResults,
	indexerId: number,
): CandidateWithIndexerId[] {
	const items = xml?.rss?.channel?.[0]?.item;
	if (!items || !Array.isArray(items)) {
		return [];
	}

	return items.map((item) => ({
		guid: item.guid[0],
		name: item.title[0],
		tracker: (
			item?.prowlarrindexer?.[0]?._ ??
			item?.jackettindexer?.[0]?._ ??
			item?.indexer?.[0]?._ ??
			UNKNOWN_TRACKER
		).trim(),
		link: item.link[0],
		size: Number(item.size[0]),
		pubDate: new Date(item.pubDate[0]).getTime(),
		indexerId,
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
		musicSearch: Boolean(isAvailable(searchingSection?.["music-search"])),
		audioSearch: Boolean(isAvailable(searchingSection?.["audio-search"])),
		bookSearch: Boolean(isAvailable(searchingSection?.["book-search"])),
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
		? getRelevantArrIds(caps, parsedMedia)
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
	const parsedMedia = res.orElse(undefined);
	logger.info(
		// @ts-expect-error needs conversion to use searchee instead of stem
		`ID: ${inspect(await createTorznabSearchQueries(stem, mediaType, ALL_CAPS, parsedMedia))}`,
	);
}

export function indexerDoesSupportMediaType(mediaType: MediaType, i: Indexer) {
	switch (mediaType) {
		case MediaType.EPISODE:
		case MediaType.SEASON:
			return i.tvSearchCap || i.categories.xxx;
		case MediaType.MOVIE:
			return i.movieSearchCap || i.categories.xxx;
		case MediaType.ANIME:
		case MediaType.VIDEO:
			return (
				i.movieSearchCap ||
				i.tvSearchCap ||
				i.categories.movie ||
				i.categories.tv ||
				i.categories.anime ||
				i.categories.xxx
			);
		case MediaType.AUDIO:
			return i.audioSearchCap || i.musicSearchCap || i.categories.audio;
		case MediaType.BOOK:
			return i.bookSearchCap || i.categories.book;
		case MediaType.OTHER:
			return i.categories.additional;
	}
}

export async function* rssPager(
	indexer: Indexer,
	timeSinceLastRun: number,
): AsyncGenerator<Candidate, void, undefined> {
	const limit = indexer.limits.max;
	const lastSeenGuid: string | undefined = (
		await db("rss")
			.where({ indexer_id: indexer.id })
			.select("last_seen_guid")
			.first()
	)?.last_seen_guid;
	let newLastSeenGuid: string | undefined = lastSeenGuid;
	let pageBackUntil = 0;
	const maxPage = 10;
	let i = -1;
	while (++i < maxPage) {
		let currentPageCandidates: CandidateWithIndexerId[];

		try {
			currentPageCandidates = (
				await makeRequest(
					{
						indexerId: indexer.id,
						baseUrl: indexer.url,
						apikey: indexer.apikey,
						query: { t: "search", q: "", limit, offset: i * limit },
						name: indexer.name,
					},
					Label.RSS,
				)
			).sort(comparing((candidate) => -candidate.pubDate!));
			if (!currentPageCandidates.length) {
				(i === 0 ? logger.error : logger.verbose)({
					label: Label.RSS,
					message: `Paging ${indexer.name ?? indexer.url} stopped at page ${i + 1}: no results returned`,
				});
				break;
			}
			if (i === 0) {
				newLastSeenGuid = currentPageCandidates[0].guid;
				pageBackUntil =
					currentPageCandidates[0].pubDate! - timeSinceLastRun;
			}
		} catch (e) {
			logger.error({
				label: Label.RSS,
				message: `Paging ${indexer.name ?? indexer.url} stopped at page ${i + 1}: ${e.message}`,
			});
			logger.debug(e);
			break;
		}

		let newCandidates: Candidate[] = [];
		let found = false;
		for (const candidate of currentPageCandidates) {
			if (candidate.guid === lastSeenGuid) {
				found = true;
				break;
			}
			newCandidates.push(candidate);
		}
		if (!found) {
			newCandidates = newCandidates.filter(
				(candidate) => candidate.pubDate! >= pageBackUntil,
			);
		}

		if (!newCandidates.length) {
			logger.verbose({
				label: Label.RSS,
				message: `Paging ${indexer.name ?? indexer.url} stopped at page ${i + 1}: no new candidates`,
			});
			break;
		}

		logger.verbose({
			label: Label.RSS,
			message: `${newCandidates.length} new candidates on ${indexer.name ?? indexer.url} page ${i + 1}`,
		});
		yield* newCandidates;

		if (newCandidates.length !== currentPageCandidates.length) {
			logger.verbose({
				label: Label.RSS,
				message: `Paging ${indexer.name ?? indexer.url} stopped at page ${i + 1}: reached last seen guid or pageBackUntil ${humanReadableDate(pageBackUntil)}`,
			});
			break;
		}
	}
	await db("rss")
		.insert({ indexer_id: indexer.id, last_seen_guid: newLastSeenGuid })
		.onConflict("indexer_id")
		.merge(["last_seen_guid"]);
	if (i >= maxPage) {
		logger.verbose({
			label: Label.RSS,
			message: `Paging ${indexer.name ?? indexer.url} stopped: reached ${maxPage} pages`,
		});
	}
}

export async function queryRssFeeds(
	lastRun: number,
): Promise<AsyncGenerator<Candidate>[]> {
	const timeSinceLastRun = Date.now() - lastRun;
	const indexers = await getEnabledIndexers();
	return indexers.map((indexer) => rssPager(indexer, timeSinceLastRun));
}

export async function searchTorznab(
	searchee: SearcheeWithLabel,
	indexerSearchCount: Map<number, number>,
	cachedSearch: CachedSearch,
	progress: string,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<IndexerCandidates[]> {
	const { torznab } = getRuntimeConfig();
	if (torznab.length === 0) {
		logger.warn({
			label: Label.SEARCH,
			message: "no indexers are available, skipping search",
		});
		return [];
	}

	const mediaType = getMediaType(searchee);
	const { indexersToSearch, parsedMedia } = await getAndLogIndexers(
		searchee,
		indexerSearchCount,
		cachedSearch,
		mediaType,
		progress,
		options,
	);
	const indexerCandidates = await makeRequests(
		indexersToSearch,
		searchee.label,
		async (indexer): Promise<Query[]> => {
			const caps = {
				search: indexer.searchCap,
				tvSearch: indexer.tvSearchCap,
				movieSearch: indexer.movieSearchCap,
				musicSearch: indexer.musicSearchCap,
				audioSearch: indexer.audioSearchCap,
				bookSearch: indexer.bookSearchCap,
				tvIdSearch: indexer.tvIdCaps,
				movieIdSearch: indexer.movieIdCaps,
				categories: indexer.categories,
				limits: indexer.limits,
			};
			return createTorznabSearchQueries(
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

async function fetchCaps(indexer: Indexer): Promise<Caps> {
	let response: Response;
	try {
		response = await fetch(
			assembleUrl(indexer.url, indexer.apikey, { t: "caps" }),
			{ signal: AbortSignal.timeout(ms("1 minute")) },
		);
	} catch (e) {
		const error = new Error(
			`${indexer.name ?? indexer.url} failed to respond, check verbose logs: ${e.message}`,
		);
		logger.error(error.message);
		logger.debug(e);
		throw error;
	}

	const responseText = await response.text();
	if (!response.ok) {
		let error: Error;
		if (response.status === 429) {
			error = new Error(
				`${indexer.name ?? indexer.url} was rate limited when fetching caps${indexer.retryAfter && indexer.retryAfter > Date.now() ? `, snoozing until ${humanReadableDate(indexer.retryAfter)}` : ""}`,
			);
			logger.warn(error.message);
		} else if (response.status === 401) {
			error = new Error(
				`${indexer.name ?? indexer.url} returned 401 Unauthorized when fetching caps, check your apikey (all torznab entries use the Prowlarr/Jackett apikey)`,
			);
			logger.error(error.message);
		} else {
			error = new Error(
				`${indexer.name ?? indexer.url} responded with code ${response.status} when fetching caps, check verbose logs`,
			);
			logger.error(error.message);
		}
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
			`${indexer.name ?? indexer.url} responded with invalid XML when fetching caps, check verbose logs`,
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
	for (const indexer of await getAllIndexers()) {
		if (!indexer.categories) {
			logger.error({
				label: Label.TORZNAB,
				message: `Indexer ${indexer.name ?? indexer.url} failed to fetch caps`,
			});
			continue;
		}
		const supported: string[] = [];
		const unsupported: string[] = [];
		for (const mediaType of Object.keys(MediaType)) {
			if (indexerDoesSupportMediaType(MediaType[mediaType], indexer)) {
				supported.push(mediaType);
			} else {
				unsupported.push(mediaType);
			}
		}
		logger.verbose({
			label: Label.TORZNAB,
			message: `${indexer.name ?? indexer.url} MediaTypes: Supported [${supported.join(", ")}] | Unsupported [${unsupported.join(", ")}]`,
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
	await updateCaps();

	const indexersWithoutSearch = await db("indexer")
		.where({ search_cap: false, active: true })
		.select({ id: "id", url: "url" });

	for (const indexer of indexersWithoutSearch) {
		logger.warn(
			`Ignoring indexer that doesn't support searching: ${indexer.name ?? indexer.url}`,
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
 * @returns the retry time in ms
 */
async function onResponseNotOk(
	response: Response,
	indexerId: number,
): Promise<number> {
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
	return retryAfter;
}

async function makeRequest(
	request: TorznabRequest,
	searcheeLabel: string,
): Promise<CandidateWithIndexerId[]> {
	const { searchTimeout } = getRuntimeConfig();
	const url = assembleUrl(request.baseUrl, request.apikey, request.query);
	const abortSignal =
		typeof searchTimeout === "number"
			? AbortSignal.timeout(searchTimeout)
			: undefined;
	logger.verbose({
		label: searcheeLabel,
		message: `Querying ${request.name ?? request.indexerId} at ${request.baseUrl} with ${inspect(request.query)}`,
	});
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
		signal: abortSignal,
	});
	if (!response.ok) {
		const retryAffter = await onResponseNotOk(response, request.indexerId);
		throw new Error(
			`request failed with code ${response.status}${response.status === 429 ? " due to rate limiting" : ""}, snoozing until ${humanReadableDate(retryAffter)}`,
		);
	}
	const xml = await response.text();
	const torznabResults: unknown = await xml2js.parseStringPromise(xml);
	const candidates = parseTorznabResults(
		torznabResults as TorznabResults,
		request.indexerId,
	);
	if (candidates.length && candidates[0].tracker !== UNKNOWN_TRACKER) {
		await db("indexer")
			.where({ id: request.indexerId })
			.update({ name: candidates[0].tracker });
	}
	return candidates;
}

async function makeRequests(
	indexers: Indexer[],
	searcheeLabel: string,
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
				name: indexer.name,
			})),
		);
	}

	const outcomes = await Promise.allSettled<CandidateWithIndexerId[]>(
		requests.map((request) => makeRequest(request, searcheeLabel)),
	);

	const { rejected, fulfilled } = collateOutcomes<
		number,
		CandidateWithIndexerId[]
	>(
		requests.map((request) => request.indexerId),
		outcomes,
	);

	for (const [indexerId, reason] of rejected) {
		const indexer = indexers.find((i) => i.id === indexerId)!;
		logger.warn({
			label: searcheeLabel,
			message: `Failed to reach ${indexer.name ?? indexer.url}: ${reason instanceof Error ? reason.message : reason}`,
		});
		logger.debug(reason);
	}

	return fulfilled.map(([indexerId, results]) => ({
		indexerId,
		candidates: results,
	}));
}

async function getAndLogIndexers(
	searchee: SearcheeWithLabel,
	indexerSearchCount: Map<number, number>,
	cachedSearch: CachedSearch,
	mediaType: MediaType,
	progress: string,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<{ indexersToSearch: Indexer[]; parsedMedia?: ParsedMedia }> {
	const {
		delay,
		excludeRecentSearch,
		excludeOlder,
		seasonFromEpisodes,
		searchLimit,
	} = getRuntimeConfig(options?.configOverride);
	const searcheeLog = getLogString(searchee, chalk.bold.white);
	const mediaTypeLog = chalk.white(mediaType.toUpperCase());

	const allIndexers = await getAllIndexers();
	const enabledIndexers = await getEnabledIndexers();

	// search history for name across all indexers
	const timestampDataSql = await db("searchee")
		.join("timestamp", "searchee.id", "timestamp.searchee_id")
		.join("indexer", "timestamp.indexer_id", "indexer.id")
		.whereIn(
			"indexer.id",
			allIndexers.map((i) => i.id),
		)
		.andWhere("searchee.name", searchee.title)
		.select({
			indexerId: "indexer.id",
			firstSearched: "timestamp.first_searched",
			lastSearched: "timestamp.last_searched",
		});

	const skipBefore = excludeOlder
		? nMsAgo(excludeOlder)
		: Number.NEGATIVE_INFINITY;
	const skipAfter = excludeRecentSearch
		? nMsAgo(excludeRecentSearch)
		: Number.POSITIVE_INFINITY;
	const isEnsemble =
		seasonFromEpisodes && !searchee.infoHash && !searchee.path;
	const newestFileAge = isEnsemble
		? await getSearcheeNewestFileAge(searchee as SearcheeWithoutInfoHash)
		: Number.POSITIVE_INFINITY;
	const disabledIndexers: Indexer[] = [];
	const timeFilteredIndexers = allIndexers.filter((indexer) => {
		if (indexer.searchCap === false) return false;
		const entry = timestampDataSql.find(
			(entry) => entry.indexerId === indexer.id,
		);
		if (!entry) {
			if (!enabledIndexers.some((i) => i.id === indexer.id)) {
				if (indexerDoesSupportMediaType(mediaType, indexer)) {
					disabledIndexers.push(indexer);
				}
				return false;
			}
			return true;
		}
		if (
			isEnsemble &&
			entry.lastSearched &&
			entry.lastSearched < newestFileAge
		) {
			if (!enabledIndexers.some((i) => i.id === indexer.id)) {
				if (indexerDoesSupportMediaType(mediaType, indexer)) {
					disabledIndexers.push(indexer);
				}
				return false;
			}
			return true;
		}
		if (entry.firstSearched && entry.firstSearched < skipBefore) {
			return false;
		}
		if (entry.lastSearched && entry.lastSearched > skipAfter) {
			return false;
		}
		if (!enabledIndexers.some((i) => i.id === indexer.id)) {
			if (indexerDoesSupportMediaType(mediaType, indexer)) {
				disabledIndexers.push(indexer);
			}
			return false;
		}
		return true;
	});

	const indexersToUse = timeFilteredIndexers.filter((indexer) =>
		indexerDoesSupportMediaType(mediaType, indexer),
	);
	if (disabledIndexers.length) {
		logger.verbose({
			label: searchee.label,
			message: `Skipping searching for ${searcheeLog} on temporarily disabled indexers [${disabledIndexers.map((i) => i.name ?? i.url).join(", ")}]`,
		});
	}

	// Invalidate cache if searchStr or ids is different
	let shouldScanArr = true;
	let parsedMedia: ParsedMedia | undefined;
	const searchStr = await getSearchString(searchee);
	if (cachedSearch.q === searchStr) {
		shouldScanArr = false;
		const res = await scanAllArrsForMedia(searchee.title, mediaType);
		parsedMedia = res.orElse(undefined);
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
	const searchLimitedIndexers: Indexer[] = [];
	const indexersToSearch = indexersToUse.filter((indexer) => {
		if (
			cachedSearch.indexerCandidates.some(
				(candidates) => candidates.indexerId === indexer.id,
			)
		) {
			return false;
		}
		if (!searchLimit) return true;

		if (!indexerSearchCount.has(indexer.id)) {
			indexerSearchCount.set(indexer.id, 0);
		}
		if (indexerSearchCount.get(indexer.id)! >= searchLimit) {
			searchLimitedIndexers.push(indexer);
			return false;
		}
		indexerSearchCount.set(
			indexer.id,
			indexerSearchCount.get(indexer.id)! + 1,
		);
		return true;
	});
	if (searchLimitedIndexers.length) {
		logger.verbose({
			label: searchee.label,
			message: `Skipping searching for ${searcheeLog} due to search limit on [${searchLimitedIndexers.map((i) => i.name ?? i.url).join(", ")}]`,
		});
	}

	if (!indexersToSearch.length && !cachedSearch.indexerCandidates.length) {
		cachedSearch.q = null; // Won't scan arrs for multiple skips in a row
		const filteringCauses = [
			enabledIndexers.length > timeFilteredIndexers.length &&
				"timestamps",
			timeFilteredIndexers.length > indexersToUse.length && "category",
			indexersToSearch.length + cachedSearch.indexerCandidates.length <
				indexersToUse.length && "searchLimit",
		].filter(isTruthy);
		const reasonStr = filteringCauses.length
			? ` (filtered by ${formatAsList(filteringCauses, { sort: true })})`
			: "";
		logger.info({
			label: searchee.label,
			message: `${progress}Skipped searching on indexers for ${searcheeLog}${reasonStr} | MediaType: ${mediaTypeLog} | IDs: N/A`,
		});
		return { indexersToSearch };
	}

	if (shouldScanArr) {
		const res = await scanAllArrsForMedia(searchee.title, mediaType);
		parsedMedia = res.orElse(undefined);
		cachedSearch.ids = parsedMedia?.movie ?? parsedMedia?.series;
	}
	const idsStr = cachedSearch.ids ? formatFoundIds(cachedSearch.ids) : "NONE";

	if (indexersToSearch.length) {
		const waitUntil = cachedSearch.lastSearch + ms(`${delay} seconds`);
		if (Date.now() < waitUntil) await wait(waitUntil - Date.now());
		cachedSearch.lastSearch = Date.now();
	}

	logger.info({
		label: searchee.label,
		message: `${progress}Searching for ${searcheeLog} | MediaType: ${mediaTypeLog} | IDs: ${idsStr}`,
	});

	return { indexersToSearch, parsedMedia };
}
