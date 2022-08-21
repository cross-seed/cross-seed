import { zip } from "lodash-es";
import fetch from "node-fetch";
import xml2js from "xml2js";
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

let activeTorznabManager: TorznabManager;

function sanitizeUrl(url: string | URL): string {
	url = new URL(url);
	return url.origin + url.pathname;
}

export class TorznabManager {
	capsMap = new Map<string, Caps>();

	/**
	 * Generates a Torznab query URL, given the srcUrl (user config)
	 * and the torznab param configuration.
	 * @param srcUrl
	 * @param params
	 */
	assembleUrl(srcUrl: string | URL, params: TorznabParams): string {
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

		// keep api keys out of the database
		const workingIndexersSanitized = workingIndexers.map(sanitizeUrl);
		const dbIndexers: string[] = await db("indexer")
			.where({ active: true })
			.pluck("url");

		const inMemoryButNotInDb = workingIndexersSanitized.filter(
			(i) => !dbIndexers.includes(i)
		);

		const inDbButNotInMemory = dbIndexers.filter(
			(i) => !workingIndexersSanitized.includes(i)
		);

		if (inDbButNotInMemory.length > 0) {
			await db("indexer")
				.whereIn("url", inDbButNotInMemory)
				.update({ active: false });
		}

		if (inMemoryButNotInDb.length > 0) {
			await db("indexer")
				.insert(
					inMemoryButNotInDb.map((url) => ({ url, active: true }))
				)
				.onConflict("url")
				.merge(["active"]);
		}
	}

	async fetchCaps(url: string | URL): Promise<Caps> {
		return fetch(this.assembleUrl(url, { t: "caps" }))
			.then((r) => r.text())
			.then(xml2js.parseStringPromise)
			.then(this.parseCaps);
	}

	parseCaps(xml): Caps {
		const capsSection = xml?.caps?.searching?.[0];
		const isAvailable = (searchTechnique) =>
			searchTechnique?.[0]?.$?.available === "yes";
		return {
			search: isAvailable(capsSection?.search),
			tvSearch: isAvailable(capsSection?.["tv-search"]),
			movieSearch: isAvailable(capsSection?.["movie-search"]),
		};
	}

	async parseResults(text: string): Promise<Candidate[]> {
		const jsified = await xml2js.parseStringPromise(text);
		const items = jsified?.rss?.channel?.[0]?.item;
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
		}));
	}

	getBestSearchTechnique(name: string, caps: Caps): TorznabParams {
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

	async updateSearchTimestamps(name: string, indexers: string[]) {
		for (const indexer of indexers) {
			await db.transaction(async (trx) => {
				const now = Date.now();
				const { id: searchee_id } = await trx("searchee")
					.where({ name })
					.select("id")
					.first();
				const { id: indexer_id } = await trx("indexer")
					.where({ url: sanitizeUrl(indexer) })
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
			return this.assembleUrl(
				url,
				this.getBestSearchTechnique(name, caps)
			);
		});
		searchUrls.forEach(
			(message) => void logger.verbose({ label: Label.TORZNAB, message })
		);

		const outcomes = await Promise.allSettled<Candidate[]>(
			searchUrls.map((url) =>
				fetch(url)
					.then((response) => {
						if (!response.ok) {
							throw new Error(
								`Querying "${url}" failed with code: ${response.status}`
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
				const [url] = indexersToUse[idx];
				if (cur.status === "rejected") {
					rejected.push([url, cur]);
				} else {
					fulfilled.push([url, cur]);
				}
				return { rejected, fulfilled };
			},
			{ rejected: [], fulfilled: [] }
		);

		rejected
			.map(
				([url, outcome]) =>
					`Failed searching ${url} for ${name} with reason: ${outcome.reason}`
			)
			.forEach(logger.warn);

		await this.updateSearchTimestamps(
			name,
			fulfilled.map(([url]) => url)
		);
		return fulfilled.flatMap(([, outcome]) => outcome.value);
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
