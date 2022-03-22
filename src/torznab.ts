import { zip } from "lodash-es";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { EP_REGEX, SEASON_REGEX } from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Candidate } from "./pipeline.js";
import { getRuntimeConfig, NonceOptions } from "./runtimeConfig.js";
import {
	cleanseSeparators,
	getTag,
	MediaType,
	reformatTitleForSearching,
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

export class TorznabManager {
	capsMap = new Map<URL, Caps>();

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
			this.capsMap.set(url, caps);
		}

		if (trackersWithSearchingCaps.length === 0) {
			throw new CrossSeedError("no working indexers available");
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
		const extractNumber = (str: string): number =>
			parseInt(str.match(/\d+/)[0]);
		const encode = (str) => encodeURIComponent(str).split("%20").join(" ");
		const mediaType = getTag(name);
		if (mediaType === MediaType.EPISODE && caps.tvSearch) {
			const match = name.match(EP_REGEX);
			return {
				t: "tvsearch",
				q: encode(cleanseSeparators(match.groups.title)),
				season: extractNumber(match.groups.season),
				ep: extractNumber(match.groups.episode),
			};
		} else if (mediaType === MediaType.SEASON && caps.tvSearch) {
			const match = name.match(SEASON_REGEX);
			return {
				t: "tvsearch",
				q: encode(cleanseSeparators(match.groups.title)),
				season: extractNumber(match.groups.season),
			};
		} else {
			return {
				t: "search",
				q: encode(reformatTitleForSearching(name)),
			};
		}
	}

	async searchTorznab(
		name: string,
		nonceOptions: NonceOptions
	): Promise<Candidate[]> {
		const searchUrls = Array.from(this.capsMap).map(
			([url, caps]: [URL, Caps]) => {
				return this.assembleUrl(
					url,
					this.getBestSearchTechnique(name, caps)
				);
			}
		);
		searchUrls.forEach(
			(message) => void logger.verbose({ label: Label.TORZNAB, message })
		);
		const outcomes = await Promise.allSettled<Candidate[]>(
			searchUrls.map((url) =>
				fetch(url)
					.then((r) => r.text())
					.then(this.parseResults)
			)
		);
		const rejected = zip(Array.from(this.capsMap.keys()), outcomes).filter(
			([, outcome]) => outcome.status === "rejected"
		);
		rejected
			.map(
				([url, outcome]) =>
					`Failed searching ${url} for ${name} with reason: ${outcome.reason}`
			)
			.forEach(logger.warn);

		const fulfilled = outcomes
			.filter(
				(outcome): outcome is PromiseFulfilledResult<Candidate[]> =>
					outcome.status === "fulfilled"
			)
			.map((outcome) => outcome.value);
		return [].concat(...fulfilled);
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
