import ms from "ms";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { EP_REGEX, SEASON_REGEX } from "./constants.js";
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
import {
	cleanseSeparators,
	getTag,
	MediaType,
	nMsAgo,
	reformatTitleForSearching,
	stripExtension,
} from "./utils.js";

interface TorznabParams {
	t: "caps" | "search" | "tvsearch" | "movie";
	q?: string;
	limit?: number;
	offset?: number;
	apikey?: string;
	season?: number;
	ep?: number;
}

interface Caps {
	search: boolean;
	tvSearch: boolean;
	movieSearch: boolean;
}

type TorznabSearchTechnique = [] | [{ $?: { available: "yes" | "no" } }];

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

function sanitizeUrl(url: string | URL): string {
	url = new URL(url);
	return url.origin + url.pathname;
}

function getApikey(url: string) {
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

function parseTorznabCaps(xml: TorznabCaps): Caps {
	const capsSection = xml?.caps?.searching?.[0];
	const isAvailable = (searchTechnique) =>
		searchTechnique?.[0]?.$?.available === "yes";
	return {
		search: Boolean(isAvailable(capsSection?.search)),
		tvSearch: Boolean(isAvailable(capsSection?.["tv-search"])),
		movieSearch: Boolean(isAvailable(capsSection?.["movie-search"])),
	};
}

function createTorznabSearchQuery(name: string, caps: Caps) {
	const nameWithoutExtension = stripExtension(name);
	const extractNumber = (str: string): number =>
		parseInt(str.match(/\d+/)[0]);
	const mediaType = getTag(nameWithoutExtension);
	if (mediaType === MediaType.EPISODE && caps.tvSearch) {
		const match = nameWithoutExtension.match(EP_REGEX);
		return {
			t: "tvsearch",
			q: cleanseSeparators(match.groups.title),
			season: extractNumber(match.groups.season),
			ep: extractNumber(match.groups.episode),
		} as const;
	} else if (mediaType === MediaType.SEASON && caps.tvSearch) {
		const match = nameWithoutExtension.match(SEASON_REGEX);
		return {
			t: "tvsearch",
			q: cleanseSeparators(match.groups.title),
			season: extractNumber(match.groups.season),
		} as const;
	} else {
		return {
			t: "search",
			q: reformatTitleForSearching(nameWithoutExtension),
		} as const;
	}
}

export async function queryRssFeeds(): Promise<Candidate[]> {
	const candidatesByUrl = await makeRequests(
		"",
		await getEnabledIndexers(),
		() => ({ t: "search", q: "" })
	);
	return candidatesByUrl.flatMap((e) => e.candidates);
}

export async function searchTorznab(name: string): Promise<Candidate[]> {
	const { excludeRecentSearch, excludeOlder } = getRuntimeConfig();

	// search history for name across all indexers
	const timestampDataSql = await db("searchee")
		.join("timestamp", "searchee.id", "timestamp.searchee_id")
		.join("indexer", "timestamp.indexer_id", "indexer.id")
		.where({ name })
		.select({
			indexerId: "indexer.id",
			firstSearched: "timestamp.first_searched",
			lastSearched: "timestamp.last_searched",
		});
	const enabledIndexers = await getEnabledIndexers();
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

	const responses = await makeRequests(name, indexersToUse, (indexer) =>
		createTorznabSearchQuery(name, {
			search: indexer.searchCap,
			tvSearch: indexer.tvSearchCap,
			movieSearch: indexer.movieSearchCap,
		})
	);
	return responses.flatMap((e) =>
		e.candidates.map((candidate) => ({
			...candidate,
			indexerId: e.indexerId,
		}))
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
			movieSearchCap: "movie_search_cap",
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
					apikey: getApikey(configIndexer),
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

function fetchCaps(indexer: {
	id: number;
	url: string;
	apikey: string;
}): Promise<Caps> {
	return fetch(assembleUrl(indexer.url, indexer.apikey, { t: "caps" }))
		.then((r) => r.text())
		.then(xml2js.parseStringPromise)
		.then(parseTorznabCaps);
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
	const { fulfilled, rejected } = collateOutcomes<number, Caps>(
		indexers.map((i) => i.id),
		outcomes
	);
	for (const [indexerId, reason] of rejected) {
		logger.warn(
			`Failed to reach ${indexers.find((i) => i.id === indexerId).url}`
		);
		logger.debug(reason);
	}

	for (const [indexerId, caps] of fulfilled) {
		await db("indexer").where({ id: indexerId }).update({
			search_cap: caps.search,
			tv_search_cap: caps.tvSearch,
			movie_search_cap: caps.movieSearch,
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
		throw new CrossSeedError("no working indexers available");
	}
}

async function makeRequests(
	name: string,
	indexers: Indexer[],
	getQuery: (indexer: Indexer) => TorznabParams
): Promise<{ indexerId: number; candidates: Candidate[] }[]> {
	const searchUrls = indexers.map((indexer: Indexer) =>
		assembleUrl(indexer.url, indexer.apikey, getQuery(indexer))
	);
	searchUrls.forEach(
		(message) => void logger.verbose({ label: Label.TORZNAB, message })
	);
	const abortControllers = Array.from(
		new Array(20),
		() => new AbortController()
	);

	setTimeout(() => {
		for (const abortController of abortControllers) {
			abortController.abort();
		}
	}, 10000);
	const outcomes = await Promise.allSettled<Candidate[]>(
		searchUrls.map((url, i) =>
			fetch(url, {
				headers: { "User-Agent": "cross-seed" },
				signal: abortControllers[i].signal,
			})
				.then((response) => {
					if (!response.ok) {
						if (response.status === 429) {
							updateIndexerStatus(
								IndexerStatus.RATE_LIMITED,
								Date.now() + ms("1 hour"),
								[indexers[i].id]
							);
						} else {
							updateIndexerStatus(
								IndexerStatus.UNKNOWN_ERROR,
								Date.now() + ms("1 hour"),
								[indexers[i].id]
							);
						}
						throw new Error(
							`request failed with code: ${response.status}`
						);
					}
					return response;
				})
				.then((r) => r.text())
				.then(xml2js.parseStringPromise)
				.then(parseTorznabResults)
		)
	);

	const { rejected, fulfilled } = collateOutcomes<number, Candidate[]>(
		indexers.map((indexer) => indexer.id),
		outcomes
	);

	for (const [indexerId, reason] of rejected) {
		logger.warn(
			`Failed to reach ${indexers.find((i) => i.id === indexerId).url}`
		);
		logger.debug(reason);
	}

	return fulfilled.map(([indexerId, results]) => ({
		indexerId,
		candidates: results,
	}));
}
