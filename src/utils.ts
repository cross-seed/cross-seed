import path, { basename } from "path";
import {
	EP_REGEX,
	MOVIE_REGEX,
	SEASON_REGEX,
	ANIME_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { Result, resultOf, resultOfErr } from "./Result.js";

export enum MediaType {
	EPISODE = "episode",
	SEASON = "pack",
	MOVIE = "movie",
	ANIME = "anime",
	OTHER = "unknown",
}

type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export function isTruthy<T>(value: T): value is Truthy<T> {
	return Boolean(value);
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
export function humanReadableSize(
	bytes: number,
	dm: number = 2,
	ibi: boolean = false
) {
	const k = ibi ? 1024 : 1000;
	const sizes = ibi
		? ["B", "kiB", "MiB", "GiB", "TiB"]
		: ["B", "kB", "MB", "GB", "TB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
export function getTag(name: string, isVideo: boolean): MediaType {
	return EP_REGEX.test(name)
		? MediaType.EPISODE
		: SEASON_REGEX.test(name)
			? MediaType.SEASON
			: MOVIE_REGEX.test(name)
				? MediaType.MOVIE
				: isVideo && ANIME_REGEX.test(name)
					? MediaType.ANIME
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
		.replace(/\[.*?\]|「.*?」|｢.*?｣|【.*?】/g, "")
		.replace(/[._()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function getAnimeQueries(name: string): string[] {
	// Only use if getTag returns anime as it's conditional on a few factors
	const animeQueries: string[] = [];
	const { title, altTitle, release } = name.match(ANIME_REGEX)?.groups ?? {};
	if (title) {
		animeQueries.push(cleanseSeparators(`${title} ${release}`));
	}
	if (altTitle) {
		animeQueries.push(cleanseSeparators(`${altTitle} ${release}`));
	}
	return animeQueries;
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

export function fallback<T>(...args: T[]): T | undefined {
	for (const arg of args) {
		if (arg !== undefined) return arg;
	}
	return undefined;
}

export function extractCredentialsFromUrl(
	url: string,
	basePath?: string,
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
