import path, { basename } from "path";
import {
	EP_REGEX,
	MOVIE_REGEX,
	SEASON_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { Result, resultOf, resultOfErr } from "./Result.js";

export enum MediaType {
	EPISODE = "episode",
	SEASON = "pack",
	MOVIE = "movie",
	OTHER = "unknown",
}

export function stripExtension(filename: string): string {
	for (const ext of VIDEO_EXTENSIONS) {
		if (filename.endsWith(ext)) return basename(filename, ext);
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

export const tap = (fn) => (value) => {
	fn(value);
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

export function formatAsList(strings: string[]) {
	return new Intl.ListFormat("en", {
		style: "long",
		type: "conjunction",
	}).format(strings.sort((a, b) => a.localeCompare(b)));
}

export function fallback<T>(...args: T[]): T {
	for (const arg of args) {
		if (arg !== undefined) return arg;
	}
	return undefined;
}

export function extractCredentialsFromUrl(
	url: string,
	basePath?: string
): Result<{ username: string; password: string; href: string }, "invalid URL"> {
	try {
		const { origin, pathname, username, password } = new URL(url);
		return resultOf({
			username: decodeURIComponent(username),
			password: decodeURIComponent(password),
			href: basePath
				? origin + path.posix.join(pathname, basePath)
				: pathname === "/"
				? origin
				: origin + pathname,
		});
	} catch (e) {
		return resultOfErr("invalid URL");
	}
}
