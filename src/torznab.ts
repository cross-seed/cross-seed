import { parse } from "@typescript-eslint/parser";
import { zip } from "lodash-es";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { parseNumbers } from "xml2js/lib/processors.js";
import { EP_REGEX, SEASON_REGEX } from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Candidate } from "./pipeline.js";
import { EmptyNonceOptions, getRuntimeConfig } from "./runtimeConfig.js";
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

let activeTorznabManager: TorznabManager;

function sanitizeUrl(url: string | URL): string {
	url = new URL(url);
	return url.origin + url.pathname;
}

function getApikey(url: string) {
	return new URL(url).searchParams.get("apikey");
}

async function getEnabledIndexers() {
	const { torznab } = getRuntimeConfig();
	const indexers = await db("indexer")
		.whereIn("url", torznab.map(sanitizeUrl))
		.select("*");
	if (indexers.length === torznab.length) return indexers;

	syncWithDb();
}

export function fetchWithClientTimeout(url, init = {}, timeout = 10000) {
	const abortController = new AbortController();
	return fetch(url, { ...init, signal: abortController.signal });
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
		search: isAvailable(capsSection?.search),
		tvSearch: isAvailable(capsSection?.["tv-search"]),
		movieSearch: isAvailable(capsSection?.["movie-search"]),
	};
}

function createTorznabQuery(name: string, caps: Caps) {
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
		};
	} else if (mediaType === MediaType.SEASON && caps.tvSearch) {
		const match = nameWithoutExtension.match(SEASON_REGEX);
		return {
			t: "tvsearch",
			q: cleanseSeparators(match.groups.title),
			season: extractNumber(match.groups.season),
		};
	} else {
		return {
			t: "search",
			q: reformatTitleForSearching(nameWithoutExtension),
		};
	}
}

// convert to indexer ids
async function updateSearchTimestamps(name: string, indexerIds: number[]) {
	for (const indexerId of indexerIds) {
		await db.transaction(async (trx) => {
			const now = Date.now();
			const { id: searchee_id } = await trx("searchee")
				.where({ name })
				.select("id")
				.first();
			// here
			const { id: indexer_id } = await trx("indexer")
				.where({ id: indexerId })
				.select("id")
				.first();

			await trx("timestamp")
				.insert({
					searchee_id,
					indexer_id,
					last_searched: now,
					first_searched: now,
				})
				.onConflict(["searchee_id", "indexer_id"])
				.merge(["searchee_id", "indexer_id", "last_searched"]);
		});
	}
}

function queryRssFeeds() {}

function searchTorznab() {}

function validateTorznabUrls() {}

async function syncWithDb() {
	const { torznab } = getRuntimeConfig();

	const dbIndexers = await db("indexer").where({ active: true }).select({
		id: "id",
		url: "url",
		apikey: "apikey",
		active: "active",
		status: "status",
		statusUpdatedAt: "status_updated_at",
		searchCap: "search_cap",
		tvSearchCap: "tv_search_cap",
		movieSearchCap: "movie_search_cap",
	});

	const inMemoryButNotInDb = torznab.filter(
		(configIndexer) =>
			!dbIndexers.some(
				(dbIndexer) => dbIndexer.url === sanitizeUrl(configIndexer)
			)
	);

	const inDbButNotInMemory = dbIndexers.filter(
		(dbIndexer) =>
			!torznab.some(
				(configIndexer) => getApikey(configIndexer) === dbIndexer.url
			)
	);

	const dbIndexersWithStaleApikeys = dbIndexers.reduce((acc, dbIndexer) => {
		const configIndexer = torznab.find(
			(configIndexer) => sanitizeUrl(configIndexer) === dbIndexer.url
		);
		if (configIndexer && dbIndexer.apikey !== getApikey(configIndexer)) {
			acc.push({ ...dbIndexer, apikey: getApikey(configIndexer) });
		}
		return acc;
	}, []);

	if (inDbButNotInMemory.length > 0) {
		await db("indexer")
			.whereIn(
				"url",
				inDbButNotInMemory.map((indexer) => indexer.url)
			)
			.update({ active: false });
	}

	if (inMemoryButNotInDb.length > 0) {
		await db("indexer")
			.insert(
				inMemoryButNotInDb.map((url) => ({
					url: sanitizeUrl(url),
					apikey: getApikey(url),
					active: true,
				}))
			)
			.onConflict("url")
			.merge(["active"]);
	}

	await db.transaction(async (trx) => {
		for (const dbIndexer of dbIndexersWithStaleApikeys) {
			await trx("indexer")
				.where({ id: dbIndexer.id })
				.update({ apikey: dbIndexer.apikey });
		}
	});
}

/**
 * Generates a Torznab query URL, given the srcUrl (user config)
 * and the torznab param configuration.
 * @param srcUrl
 * @param params
 */
function assembleUrl(srcUrl: string | URL, params: TorznabParams): string {
	const url = new URL(srcUrl);
	const apikey = url.searchParams.get("apikey");
	const searchParams = new URLSearchParams();

	searchParams.set("apikey", apikey);

	for (const [key, value] of Object.entries(params)) {
		if (value != null) searchParams.set(key, value);
	}

	url.search = searchParams.toString();
	return url.toString();
}

function fetchCaps(url: string | URL): Promise<Caps> {
	return fetch(assembleUrl(url, { t: "caps" }))
		.then((r) => r.text())
		.then(xml2js.parseStringPromise)
		.then(parseTorznabCaps);
}

export class TorznabManager {
	capsMap = new Map<string, Caps>();

	async validateTorznabUrls() {
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

		const outcomes = await Promise.allSettled(
			urls.map((url) => this.fetchCaps(url))
		);

		const zipped: [URL, PromiseSettledResult<Caps>][] = zip(urls, outcomes);

		// handle promise rejections
		const rejected: [URL, PromiseRejectedResult][] = zipped.filter(
			(bundle): bundle is [URL, PromiseRejectedResult] =>
				bundle[1].status === "rejected"
		);

		for (const [url, outcome] of rejected) {
			logger.warn(`Failed to reach ${url}`);
			logger.debug(outcome.reason);
		}

		const fulfilled = zipped
			.filter(
				(bundle): bundle is [URL, PromiseFulfilledResult<Caps>] =>
					bundle[1].status === "fulfilled"
			)
			.map(
				([url, outcome]: [URL, PromiseFulfilledResult<Caps>]): [
					URL,
					Caps
				] => [url, outcome.value]
			);

		// handle trackers that can't search
		const trackersWithoutSearchingCaps = fulfilled.filter(
			([, caps]) => !caps.search
		);
		trackersWithoutSearchingCaps
			.map(
				([url]) =>
					`Ignoring indexer that doesn't support searching: ${url}`
			)
			.forEach(logger.warn);

		// store caps of usable trackers
		const trackersWithSearchingCaps = fulfilled.filter(
			([, caps]) => caps.search
		);

		for (const [url, caps] of trackersWithSearchingCaps) {
			this.capsMap.set(url.toString(), caps);
		}

		if (trackersWithSearchingCaps.length === 0) {
			throw new CrossSeedError("no working indexers available");
		}
		await this.syncWithDb();
	}

	async syncWithDb() {
		if (this.capsMap.size === 0) {
			logger.error({
				label: Label.TORZNAB,
				message:
					"cross-seed tried to sync with the DB before capsMap was ready",
			});
		}
		const workingIndexers = Array.from(this.capsMap.entries())
			.filter(([, caps]) => caps.search)
			.map(([url]) => url);
	}

	async updateSearchTimestamps(name: string, indexers: string[]) {}

	async queryRssFeeds() {
		const indexersToUse = Array.from(this.capsMap.keys());
		const searchUrls = indexersToUse.map((url) =>
			assembleUrl(url, { t: "search", q: "" })
		);
		const candidatesByUrl = await this.makeRequests("", searchUrls);
		return candidatesByUrl.flatMap((e) => e.candidates);
	}

	async searchTorznab(
		name: string,
		nonceOptions = EmptyNonceOptions
	): Promise<Candidate[]> {
		const { excludeRecentSearch, excludeOlder } = getRuntimeConfig();
		const timestampDataSql = await db("searchee")
			.join("timestamp", "searchee.id", "timestamp.searchee_id")
			.join("indexer", "timestamp.indexer_id", "indexer.id")
			.where({ name })
			.select({
				url: "indexer.url",
				firstSearched: "timestamp.first_searched",
				lastSearched: "timestamp.last_searched",
			});
		const indexersToUse = Array.from(this.capsMap).filter(([url]) => {
			const entry = timestampDataSql.find(
				(entry) => entry.url === sanitizeUrl(url)
			);
			return (
				!entry ||
				((!excludeOlder ||
					entry.firstSearched > nMsAgo(excludeOlder)) &&
					(!excludeRecentSearch ||
						entry.lastSearched < nMsAgo(excludeRecentSearch)))
			);
		});
		const searchUrls = indexersToUse.map(([url, caps]: [string, Caps]) => {
			return assembleUrl(url, this.getBestSearchTechnique(name, caps));
		});
		const candidatesByUrl = await this.makeRequests(name, searchUrls);

		await this.updateSearchTimestamps(
			name,
			candidatesByUrl.map((e) => e.url)
		);
		return candidatesByUrl.flatMap((e) => e.candidates);
	}

	private async makeRequests(name: string, searchUrls: string[]) {
		const abortController = new AbortController();
		setTimeout(() => void abortController.abort(), 10000);

		searchUrls.forEach(
			(message) => void logger.verbose({ label: Label.TORZNAB, message })
		);

		const outcomes = await Promise.allSettled<Candidate[]>(
			searchUrls.map((url) =>
				fetch(url, {
					headers: { "User-Agent": "cross-seed" },
					signal: abortController.signal,
				})
					.then((response) => {
						if (!response.ok) {
							throw new Error(
								`request failed with code: ${response.status}`
							);
						}
						return response;
					})
					.then((r) => r.text())
					.then(this.parseResults)
			)
		);

		const { rejected, fulfilled } = outcomes.reduce<{
			rejected: [string, PromiseRejectedResult][];
			fulfilled: [string, PromiseFulfilledResult<Candidate[]>][];
		}>(
			({ rejected, fulfilled }, cur, idx) => {
				const sanitizedUrl = sanitizeUrl(searchUrls[idx]);
				if (cur.status === "rejected") {
					rejected.push([sanitizedUrl, cur]);
				} else {
					fulfilled.push([sanitizedUrl, cur]);
				}
				return { rejected, fulfilled };
			},
			{ rejected: [], fulfilled: [] }
		);

		rejected
			.map(
				([url, outcome]) =>
					`Failed searching ${url} for "${name}" with reason: ${outcome.reason}`
			)
			.forEach(logger.warn);
		return fulfilled.map(([url, result]) => ({
			url,
			candidates: result.value,
		}));
	}
}

function instantiateTorznabManager() {
	activeTorznabManager = new TorznabManager();
}

export function getTorznabManager(): TorznabManager {
	if (!activeTorznabManager) {
		instantiateTorznabManager();
	}
	return activeTorznabManager;
}
