import path from "path";
import {
	ALL_EXTENSIONS,
	ANIME_REGEX,
	AUDIO_EXTENSIONS,
	BOOK_EXTENSIONS,
	Decision,
	EP_REGEX,
	MOVIE_REGEX,
	SCENE_TITLE_REGEX,
	SEASON_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { File, Searchee } from "./searchee.js";
import chalk, { ChalkInstance } from "chalk";
import { getRuntimeConfig } from "./runtimeConfig.js";

export enum MediaType {
	EPISODE = "episode",
	SEASON = "pack",
	MOVIE = "movie",
	ANIME = "anime",
	VIDEO = "video",
	AUDIO = "audio",
	BOOK = "book",
	OTHER = "unknown",
}

type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export function isTruthy<T>(value: T): value is Truthy<T> {
	return Boolean(value);
}

export function stripExtension(filename: string): string {
	for (const ext of ALL_EXTENSIONS) {
		if (filename.endsWith(ext)) return path.basename(filename, ext);
	}
	return filename;
}

export function nMsAgo(n: number): number {
	return Date.now() - n;
}

export function wait(n: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, n));
}
export function humanReadableSize(bytes: number) {
	const k = 1000;
	const sizes = ["B", "kB", "MB", "GB", "TB"];
	// engineering notation: (coefficient) * 1000 ^ (exponent)
	const exponent = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
	const coefficient = bytes / Math.pow(k, exponent);
	return `${parseFloat(coefficient.toFixed(2))} ${sizes[exponent]}`;
}
export function filesWithExt(files: File[], exts: string[]): File[] {
	return files.filter((f) => exts.includes(path.extname(f.name)));
}
export function hasExt(searchee: Searchee, exts: string[]): boolean {
	return searchee.files.some((f) => exts.includes(path.extname(f.name)));
}
export function getMediaType(searchee: Searchee): MediaType {
	function unsupportedMediaType(searchee: Searchee): MediaType {
		if (hasExt(searchee, AUDIO_EXTENSIONS)) {
			return MediaType.AUDIO;
		} else if (hasExt(searchee, BOOK_EXTENSIONS)) {
			return MediaType.BOOK;
		} else {
			return MediaType.OTHER;
		}
	}

	/* eslint-disable no-fallthrough */
	switch (true) {
		case EP_REGEX.test(searchee.title):
			return MediaType.EPISODE;
		case SEASON_REGEX.test(searchee.title):
			return MediaType.SEASON;
		case hasExt(searchee, VIDEO_EXTENSIONS):
			if (MOVIE_REGEX.test(searchee.title)) return MediaType.MOVIE;
			if (ANIME_REGEX.test(searchee.title)) return MediaType.ANIME;
			return MediaType.VIDEO;
		case hasExt(searchee, [".rar"]):
			if (MOVIE_REGEX.test(searchee.title)) return MediaType.MOVIE;
		default:
			return unsupportedMediaType(searchee);
	}
}
export function shouldRecheck(decision: Decision): boolean {
	switch (decision) {
		case Decision.MATCH:
		case Decision.MATCH_SIZE_ONLY:
			return false;
		case Decision.MATCH_PARTIAL:
		default:
			return true;
	}
}
export async function time<R>(cb: () => R, times: number[]) {
	const before = performance.now();
	try {
		return await cb();
	} finally {
		times.push(performance.now() - before);
	}
}
export function sanitizeUrl(url: string | URL): string {
	if (typeof url === "string") {
		url = new URL(url);
	}
	return url.origin + url.pathname;
}

export function getApikey(url: string) {
	return new URL(url).searchParams.get("apikey");
}
export function cleanseSeparators(str: string): string {
	return str
		.replace(/\[.*?\]|「.*?」|｢.*?｣|【.*?】/g, "")
		.replace(/[._()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function isBadTitle(title: string): boolean {
	return ["season", "ep"].includes(title.toLowerCase());
}

export function getAnimeQueries(name: string): string[] {
	// Only use if getMediaType returns anime as it's conditional on a few factors
	const animeQueries: string[] = [];
	const { title, altTitle, release } = name.match(ANIME_REGEX)?.groups ?? {};
	if (title) {
		animeQueries.push(cleanseSeparators(`${title} ${release}`));
	}
	if (altTitle) {
		if (isBadTitle(altTitle)) return animeQueries;
		animeQueries.push(cleanseSeparators(`${altTitle} ${release}`));
	}
	return animeQueries;
}

export function reformatTitleForSearching(title: string): string {
	return cleanseSeparators(title).match(SCENE_TITLE_REGEX)!.groups!.title;
}

export function reformatNameForSearching(name: string): string {
	return reformatTitleForSearching(
		name.match(EP_REGEX)?.groups?.title ??
			name.match(SEASON_REGEX)?.groups?.title ??
			name.match(MOVIE_REGEX)?.[0] ??
			name,
	);
}

export const tap = (fn) => (value) => {
	fn(value);
	return value;
};

export async function filterAsync(arr, predicate) {
	const results = await Promise.all(arr.map(predicate));

	return arr.filter((_, index) => results[index]);
}

export function humanReadableDate(timestamp: number): string {
	// swedish conventions roughly follow the iso format!
	return new Date(timestamp).toLocaleString("sv");
}

export function getLogString(
	searchee: Searchee,
	color: ChalkInstance = chalk.reset,
) {
	return searchee.infoHash
		? `${color(searchee.title)} ${chalk.dim(`[${searchee.infoHash.slice(0, 8)}...]`)}`
		: !searchee.path
			? color(searchee.title)
			: searchee.title === searchee.name
				? color(searchee.path)
				: `${color(searchee.title)} ${chalk.dim(`[${searchee.path}]`)}`;
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

export function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

export function extractInt(str: string): number {
	return parseInt(str.match(/\d+/)![0]);
}

export function getFuzzySizeFactor(): number {
	const { fuzzySizeThreshold } = getRuntimeConfig();
	return fuzzySizeThreshold;
}

export function getMinSizeRatio(): number {
	const { fuzzySizeThreshold } = getRuntimeConfig();
	return 1 - fuzzySizeThreshold;
}
