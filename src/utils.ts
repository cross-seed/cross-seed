import chalk, { ChalkInstance } from "chalk";
import { distance } from "fastest-levenshtein";
import path from "path";
import {
	ABS_WIN_PATH_REGEX,
	ALL_EXTENSIONS,
	ANIME_REGEX,
	AUDIO_EXTENSIONS,
	BOOK_EXTENSIONS,
	EP_REGEX,
	JSON_VALUES_REGEX,
	LEVENSHTEIN_DIVISOR,
	MediaType,
	MOVIE_REGEX,
	NON_UNICODE_ALPHANUM_REGEX,
	RELEASE_GROUP_REGEX,
	REPACK_PROPER_REGEX,
	RESOLUTION_REGEX,
	SCENE_TITLE_REGEX,
	SEASON_REGEX,
	sourceRegexRemove,
	VIDEO_DISC_EXTENSIONS,
	VIDEO_EXTENSIONS,
	YEARS_REGEX,
} from "./constants.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { File, Searchee } from "./searchee.js";

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

export function humanReadableSize(
	bytes: number,
	options?: { binary: boolean },
) {
	if (bytes === 0) return "0 B";
	const k = options?.binary ? 1024 : 1000;
	const sizes = options?.binary
		? ["B", "KiB", "MiB", "GiB", "TiB"]
		: ["B", "kB", "MB", "GB", "TB"];
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
		.map((title) => createKeyTitle(stripMetaFromName(title)))
		.filter(isTruthy);
	const titlesB: string[] = (
		matchB
			? [matchB.groups?.title, matchB.groups?.altTitle].filter(isTruthy)
			: [b]
	)
		.map((title) => createKeyTitle(stripMetaFromName(title)))
		.filter(isTruthy);
	const maxDistanceA = Math.floor(
		Math.max(...titlesA.map((t) => t.length)) / LEVENSHTEIN_DIVISOR,
	);
	const maxDistanceB = Math.floor(
		Math.max(...titlesB.map((t) => t.length)) / LEVENSHTEIN_DIVISOR,
	);
	const maxDistance = Math.max(maxDistanceA, maxDistanceB);
	return titlesA.some((titleA) =>
		titlesB.some(
			(titleB) =>
				distance(titleA, titleB) <= maxDistance ||
				titleA.includes(titleB) ||
				titleB.includes(titleA),
		),
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
		.replace(/\[.*?\]|「.*?」|｢.*?｣|【.*?】/g, "") // bracketed text
		.replace(/[._()[\]]/g, " ") // release delimiters (except '-')
		.replace(/\s+/g, " ") // successive spaces
		.replace(/^\s*-+|-+\s*$/g, "") // "trim()" hyphens
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

export function stripMetaFromName(name: string): string {
	return sourceRegexRemove(
		stripExtension(name)
			.match(SCENE_TITLE_REGEX)!
			.groups!.title.replace(RELEASE_GROUP_REGEX, "")
			.replace(/\s*-\s*$/, "")
			.replace(RESOLUTION_REGEX, "")
			.replace(REPACK_PROPER_REGEX, ""),
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
	options: {
		sort: boolean;
		style?: Intl.ListFormatStyle;
		type?: Intl.ListFormatType;
	},
) {
	if (options.sort) strings.sort((a, b) => a.localeCompare(b));
	return new Intl.ListFormat("en", {
		style: options.style ?? "long",
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

export function escapeUnescapedQuotesInJsonValues(jsonStr: string): string {
	return jsonStr.replace(
		JSON_VALUES_REGEX,
		(match, _p1, _offset, _str, groups) => {
			const escapedValue = groups.value.replace(/(?<!\\)"/g, '\\"');
			return match.replace(groups.value, escapedValue);
		},
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

/**
 * Makes comparators for `Array.prototype.sort`.
 * Second getter will be used if the first is a tie, etc.
 * Booleans are treated as 0 and 1,
 * Ascending by default, use - or ! for descending.
 * @param getters
 */
export function comparing<T>(...getters: ((e: T) => number | boolean)[]) {
	return function compare(a: T, b: T) {
		for (const getter of getters) {
			const x = getter(a);
			const y = getter(b);
			if (x < y) {
				return -1;
			} else if (x > y) {
				return 1;
			}
		}
		return 0;
	};
}

/**
 * Given multiple async iterables, this function will merge/interleave
 * them all into one iterable, yielding on a first-come, first-serve basis.
 * https://stackoverflow.com/questions/50585456/how-can-i-interleave-merge-async-iterables
 */
export async function* combineAsyncIterables<T>(
	asyncIterables: AsyncIterable<T>[],
): AsyncGenerator<T> {
	const asyncIterators = Array.from(asyncIterables, (o) =>
		o[Symbol.asyncIterator](),
	);
	let unfinishedIterators = asyncIterators.length;
	const alwaysPending: Promise<never> = new Promise(() => {});
	const getNext = (asyncIterator: AsyncIterator<T>, index: number) =>
		asyncIterator.next().then((result) => ({ index, result }));

	const nextPromises = asyncIterators.map(getNext);
	try {
		while (unfinishedIterators) {
			const { index, result } = await Promise.race(nextPromises);
			if (result.done) {
				nextPromises[index] = alwaysPending;
				unfinishedIterators--;
			} else {
				nextPromises[index] = getNext(asyncIterators[index], index);
				yield result.value;
			}
		}
	} finally {
		// cancel unfinished iterators if one throws
		for (const [index, iterator] of asyncIterators.entries()) {
			if (
				nextPromises[index] !== alwaysPending &&
				iterator.return != null
			) {
				// no await here - see https://github.com/tc39/proposal-async-iteration/issues/126
				void iterator.return();
			}
		}
	}
	return;
}

/**
 * Converts a path to a unix-style path if absolute windows path and cross-seed is on linux.
 * @param rawPath The path to convert
 * @returns The converted path
 */
export function upath(rawPath: string): string {
	if (path.sep === "\\") return rawPath; // cross-seed on windows but linux client can never work, assume client is windows
	if (ABS_WIN_PATH_REGEX.test(rawPath)) return rawPath.replace(/\\/g, "/");
	return rawPath;
}
