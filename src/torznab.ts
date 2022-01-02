import { zip } from "lodash-es";
import fetch from "node-fetch";
import Parser from "rss-parser";
import { inspect } from "util";
import xml2js from "xml2js";
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { SearchResult } from "./pipeline.js";
import { getRuntimeConfig, NonceOptions } from "./runtimeConfig.js";

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

const parser: Parser<CustomFeed, CustomItem> = new Parser({
	customFields: {
		feed: ["foo"],
		item: ["size"],
	},
});

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
		.map(
			([url]) =>
				`Disabling ${url} because it either is down or doesn't support searching`
		)
		.forEach(logger.warn);

	if (unsupported.length > 0 && unsupported.length === responses.length) {
		throw new CrossSeedError("no indexers enabled");
	}
}

export async function fetchCaps(url: string | URL): Promise<any> {
	return fetch(assembleUrl(url, { t: "caps" }))
		.then((r) => r.text())
		.then(xml2js.parseStringPromise);
}

export async function search(
	name: string,
	nonceOptions: NonceOptions
): Promise<SearchResult[]> {
	return [];
}
