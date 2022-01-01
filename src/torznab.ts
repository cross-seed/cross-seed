import fetch from "node-fetch";
import Parser from "rss-parser";
import { CrossSeedError } from "./errors.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

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
	console.log(url.toString());
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

	const responses = await Promise.all(urls.map((url) => fetchCaps(url)));
	console.log(responses);
	throw new CrossSeedError("kill");
}

export async function fetchCaps(url: string | URL) {
	return fetch(assembleUrl(url, { t: "caps" })).then((r) => r.text());
}
