import {
	EP_REGEX,
	EXTENSIONS,
	MOVIE_REGEX,
	SEASON_REGEX,
} from "./constants.js";

export enum MediaType {
	EPISODE = "episode",
	SEASON = "pack",
	MOVIE = "movie",
	OTHER = "unknown",
}

export const duration = (perfA, perfB) => (perfB - perfA).toFixed(0);

export function stripExtension(filename: string): string {
	for (const ext of EXTENSIONS) {
		const re = new RegExp(`\\.${ext}$`);
		if (re.test(filename)) return filename.replace(re, "");
	}
	return filename;
}

export function nMsAgo(n: number): number {
	return Date.now() - n;
}

export function wait(n: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, n));
}

export function getTag(name: string): MediaType {
	return EP_REGEX.test(name)
		? MediaType.EPISODE
		: SEASON_REGEX.test(name)
		? MediaType.SEASON
		: MOVIE_REGEX.test(name)
		? MediaType.MOVIE
		: MediaType.OTHER;
}

export async function time<R>(cb: () => R, times: number[]) {
	const before = performance.now();
	try {
		return await cb();
	} finally {
		times.push(performance.now() - before);
	}
}

export function cleanseSeparators(str: string): string {
	return str
		.replace(/[._()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function reformatTitleForSearching(name: string): string {
	const seasonMatch = name.match(SEASON_REGEX);
	const movieMatch = name.match(MOVIE_REGEX);
	const episodeMatch = name.match(EP_REGEX);
	const fullMatch =
		episodeMatch?.[0] ?? seasonMatch?.[0] ?? movieMatch?.[0] ?? name;
	return cleanseSeparators(fullMatch);
}
export const tapLog = (value) => {
	console.log(value);
	return value;
};

export async function filterAsync(arr, predicate) {
	const results = await Promise.all(arr.map(predicate));

	return arr.filter((_, index) => results[index]);
}

export function humanReadable(timestamp: number): string {
	// swedish conventions roughly follow the iso format!
	return new Date(timestamp).toLocaleString("sv");
}

export function formatStringsAsList(strings: string[]) {
	// @ts-expect-error Intl.ListFormat totally exists on node 12
	return new Intl.ListFormat("en", {
		style: "long",
		type: "conjunction",
	}).format(strings);
}
