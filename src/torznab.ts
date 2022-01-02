import { zip } from "lodash-es";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { SearchResult } from "./pipeline.js";
import { getRuntimeConfig, NonceOptions } from "./runtimeConfig.js";
import { reformatTitleForSearching } from "./utils.js";

interface CustomFeed {
	foo: string;
}

interface CustomItem {
	size: number;
}

interface TorznabParams {
	t: "caps" | "search";
	q?: string;
	limit?: number;
	offset?: number;
	apikey?: string;
}

export function assembleUrl(
	srcUrl: string | URL,
	params: TorznabParams
): string {
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

export async function validateTorznabUrls() {
	const { torznab } = getRuntimeConfig();
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

	const responses = await Promise.allSettled(
		urls.map((url) => fetchCaps(url))
	);
	const zipped = zip(urls, responses);
	const unsupported = zipped.filter(
		([, response]) =>
			response.value?.caps?.searching?.[0]?.search?.[0]?.$?.available !==
			"yes"
	);
	unsupported
		.map(([url]) => `${url} is either down or doesn't support searching`)
		.forEach(logger.warn);

	if (unsupported.length > 0 && unsupported.length === responses.length) {
		throw new CrossSeedError("no working indexers available");
	}
}

export async function fetchCaps(url: string | URL): Promise<any> {
	return fetch(assembleUrl(url, { t: "caps" }))
		.then((r) => r.text())
		.then(xml2js.parseStringPromise);
}

async function parse(text: string): Promise<SearchResult[]> {
	const jsified = await xml2js.parseStringPromise(text);
	const items = jsified?.rss?.channel?.[0]?.item;
	if (!items || !Array.isArray(items)) {
		return [];
	}

	return items.map((item) => ({
		guid: item.guid[0],
		title: item.title[0],
		tracker:
			item?.prowlarrindexer?.[0]?._ ??
			item?.jackettindexer?.[0]?._ ??
			item?.indexer?.[0]?._ ??
			"Unknown tracker",
		link: item.link[0],
		size: Number(item.size[0]),
	}));
}

function isFulfilled(
	outcome: PromiseSettledResult<SearchResult[]>
): outcome is PromiseFulfilledResult<SearchResult[]> {
	return outcome.status === "fulfilled";
}

export async function searchTorznab(
	name: string,
	nonceOptions: NonceOptions
): Promise<SearchResult[]> {
	const { torznab } = getRuntimeConfig();
	const searchUrls = torznab.map((url) =>
		assembleUrl(url, { t: "search", q: reformatTitleForSearching(name) })
	);
	searchUrls.forEach(
		(message) => void logger.verbose({ label: Label.TORZNAB, message })
	);
	const outcomes = await Promise.allSettled<SearchResult[]>(
		searchUrls.map((url) =>
			fetch(url)
				.then((r) => r.text())
				.then(parse)
		)
	);
	const rejected = zip(torznab, outcomes).filter(
		([, outcome]) => outcome.status === "rejected"
	);
	rejected
		.map(
			([url, outcome]) =>
				`Failed searching ${url} for ${name} with reason: ${outcome.reason}`
		)
		.forEach(logger.warn);

	const fulfilled = outcomes
		.filter(isFulfilled)
		.map((outcome) => outcome.value);
	return [].concat(...fulfilled);
}
