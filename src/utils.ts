import path from "path";
import {
	ALL_EXTENSIONS,
	ANIME_REGEX,
	AUDIO_EXTENSIONS,
	BOOK_EXTENSIONS,
	Decision,
	EP_REGEX,
	LEVENSHTEIN_DIVISOR,
	MOVIE_REGEX,
	NON_UNICODE_ALPHANUM_REGEX,
	SCENE_TITLE_REGEX,
	SEASON_REGEX,
	VIDEO_DISC_EXTENSIONS,
	VIDEO_EXTENSIONS,
	YEARS_REGEX,
} from "./constants.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { File, Searchee } from "./searchee.js";
import chalk, { ChalkInstance } from "chalk";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { distance } from "fastest-levenshtein";

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
	return files.filter((f) =>
		exts.includes(path.extname(f.name.toLowerCase())),
	);
}
export function hasExt(files: File[], exts: string[]): boolean {
	return files.some((f) => exts.includes(path.extname(f.name.toLowerCase())));
}
export function getMediaType(searchee: Searchee): MediaType {
	function unsupportedMediaType(searchee: Searchee): MediaType {
		if (hasExt(searchee.files, AUDIO_EXTENSIONS)) {
			return MediaType.AUDIO;
		} else if (hasExt(searchee.files, BOOK_EXTENSIONS)) {
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
		case hasExt(searchee.files, VIDEO_EXTENSIONS):
			if (MOVIE_REGEX.test(searchee.title)) return MediaType.MOVIE;
			if (ANIME_REGEX.test(searchee.title)) return MediaType.ANIME;
			return MediaType.VIDEO;
		case hasExt(searchee.files, VIDEO_DISC_EXTENSIONS):
			if (MOVIE_REGEX.test(searchee.title)) return MediaType.MOVIE;
			return MediaType.VIDEO;
		case hasExt(searchee.files, [".rar"]):
			if (MOVIE_REGEX.test(searchee.title)) return MediaType.MOVIE;
		default:
			return unsupportedMediaType(searchee);
	}
}

export function shouldRecheck(searchee: Searchee, decision: Decision): boolean {
	if (hasExt(searchee.files, VIDEO_DISC_EXTENSIONS)) return true;
	switch (decision) {
		case Decision.MATCH:
		case Decision.MATCH_SIZE_ONLY:
			return false;
		case Decision.MATCH_PARTIAL:
		default:
			return true;
	}
}

export function areMediaTitlesSimilar(a: string, b: string): boolean {
	const matchA =
		a.match(EP_REGEX) ??
		a.match(SEASON_REGEX) ??
		a.match(MOVIE_REGEX) ??
		a.match(ANIME_REGEX);
	const matchB =
		b.match(EP_REGEX) ??
		b.match(SEASON_REGEX) ??
		b.match(MOVIE_REGEX) ??
		b.match(ANIME_REGEX);
	const titlesA: string[] = (
		matchA
			? [matchA.groups?.title, matchA.groups?.altTitle].filter(isTruthy)
			: [a]
	)
		.map((title) => createKeyTitle(title))
		.filter(isTruthy);
	const titlesB: string[] = (
		matchB
			? [matchB.groups?.title, matchB.groups?.altTitle].filter(isTruthy)
			: [b]
	)
		.map((title) => createKeyTitle(title))
		.filter(isTruthy);
	const maxDistanceA = Math.floor(
		[...titlesA].sort((a, b) => b.length - a.length)[0].length /
			LEVENSHTEIN_DIVISOR,
	);
	const maxDistanceB = Math.floor(
		[...titlesB].sort((a, b) => b.length - a.length)[0].length /
			LEVENSHTEIN_DIVISOR,
	);
	const maxDistance = Math.max(maxDistanceA, maxDistanceB);
	return titlesA.some((titleA) =>
		titlesB.some((titleB) => distance(titleA, titleB) <= maxDistance),
	);
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
/**
 * This cannot be done at the log level because of too many false positives.
 * The caller will need to extract the infoHash from their specific syntax.
 * @param infoHash The infoHash to sanitize
 */
export function sanitizeInfoHash(infoHash: string): string {
	return `${infoHash.slice(0, 8)}...`;
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

export function cleanTitle(title: string): string {
	return cleanseSeparators(title).match(SCENE_TITLE_REGEX)!.groups!.title;
}

export function reformatTitleForSearching(name: string): string {
	const seriesTitle =
		name.match(EP_REGEX)?.groups?.title ??
		name.match(SEASON_REGEX)?.groups?.title;
	if (seriesTitle) {
		const title = cleanTitle(seriesTitle);
		return title.length > 4
			? replaceLastOccurrence(title, YEARS_REGEX, "")
					.replace(/\s+/g, " ")
					.trim()
			: title;
	}
	return cleanTitle(name.match(MOVIE_REGEX)?.[0] ?? name);
}

export function createKeyTitle(title: string): string | null {
	const key = cleanTitle(title)
		.replace(NON_UNICODE_ALPHANUM_REGEX, "")
		.toLowerCase();
	return key.length > 4
		? replaceLastOccurrence(key, YEARS_REGEX, "")
		: key.length
			? key
			: null;
}

export function isBadTitle(title: string): boolean {
	return ["season", "ep"].includes(title.toLowerCase());
}

export function getAnimeQueries(name: string): string[] {
	// Only use if getMediaType returns anime as it's conditional on a few factors
	const animeQueries: string[] = [];
	const { title, altTitle, release } = name.match(ANIME_REGEX)?.groups ?? {};
	if (title) {
		animeQueries.push(cleanTitle(`${title} ${release}`));
	}
	if (altTitle) {
		if (isBadTitle(altTitle)) return animeQueries;
		animeQueries.push(cleanTitle(`${altTitle} ${release}`));
	}
	return animeQueries;
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
	if (searchee.title === searchee.name) {
		return searchee.infoHash
			? `${color(searchee.title)} ${chalk.dim(`[${sanitizeInfoHash(searchee.infoHash)}]`)}`
			: searchee.path
				? color(searchee.path)
				: color(searchee.title);
	}
	return searchee.infoHash
		? `${color(searchee.title)} ${chalk.dim(`[${searchee.name} [${sanitizeInfoHash(searchee.infoHash)}]]`)}`
		: searchee.path
			? `${color(searchee.title)} ${chalk.dim(`[${searchee.path}]`)}`
			: `${color(searchee.title)} ${chalk.dim(`[${searchee.name}]`)}`;
}

export function formatAsList(
	strings: string[],
	options: { sort: boolean; type?: Intl.ListFormatType },
) {
	if (options.sort) strings.sort((a, b) => a.localeCompare(b));
	return new Intl.ListFormat("en", {
		style: "long",
		type: options.type ?? "conjunction",
	}).format(strings);
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

export function capitalizeFirstLetter(string: string): string {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Replaces the last occurrence of a GLOBAL regex match in a string
 * @param str The string to replace the last occurrence in
 * @param globalRegExp The regex to match (must be global)
 * @param newStr The string to replace the last occurrence with
 */
export function replaceLastOccurrence(
	str: string,
	globalRegExp: RegExp,
	newStr: string,
): string {
	const matches = Array.from(str.matchAll(globalRegExp));
	if (matches.length === 0) return str;
	const lastMatch = matches[matches.length - 1];
	const lastMatchIndex = lastMatch.index!;
	const lastMatchStr = lastMatch[0];
	return (
		str.slice(0, lastMatchIndex) +
		newStr +
		str.slice(lastMatchIndex + lastMatchStr.length)
	);
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
