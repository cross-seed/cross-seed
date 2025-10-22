import chalk, { ChalkInstance } from "chalk";
import { distance } from "fastest-levenshtein";
import {
	access,
	constants,
	readdir,
	stat,
	unlink,
	writeFile,
} from "fs/promises";
import path from "path";
import {
	ALL_EXTENSIONS,
	ALL_PARENTHESES_REGEX,
	ALL_SPACES_REGEX,
	ALL_SQUARE_BRACKETS_REGEX,
	ANIME_REGEX,
	EP_REGEX,
	JSON_VALUES_REGEX,
	LEVENSHTEIN_DIVISOR,
	MIN_VIDEO_QUERY_LENGTH,
	MOVIE_REGEX,
	NON_UNICODE_ALPHANUM_REGEX,
	RELEASE_GROUP_REGEX,
	REPACK_PROPER_REGEX,
	RESOLUTION_REGEX,
	SCENE_TITLE_REGEX,
	SEASON_REGEX,
	sourceRegexRemove,
	YEARS_REGEX,
} from "./constants.js";
import { logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { File, getAllTitles, Searchee } from "./searchee.js";

// ================================== TYPES ==================================

export type Awaitable<T> = T | Promise<T>;
type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };
export type WithUndefined<T, K extends keyof T> = Omit<T, K> & {
	[P in K]: undefined;
};

export function isTruthy<T>(value: T): value is Truthy<T> {
	return Boolean(value);
}

export function omitUndefined<T extends Record<string, unknown>>(
	obj: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}

// ==================================== OS ====================================

export async function exists(srcPath: string): Promise<boolean> {
	try {
		await access(srcPath);
		return true;
	} catch {
		return false;
	}
}

export async function notExists(srcPath: string): Promise<boolean> {
	try {
		await access(srcPath);
		return false;
	} catch {
		return true;
	}
}

export async function verifyDir(
	srcDir: string,
	testSrcName: string,
	permissions: number,
): Promise<boolean> {
	try {
		if (await notExists(srcDir)) {
			throw new Error("does not exist");
		}
		if (!(await stat(srcDir)).isDirectory()) {
			throw new Error("not a directory");
		}
		if (permissions & constants.R_OK) {
			try {
				await readdir(srcDir);
			} catch (e) {
				logger.debug(e);
				throw new Error("no read permissions");
			}
		}
		if (permissions & constants.W_OK) {
			const tempFile = path.join(srcDir, testSrcName);
			try {
				await writeFile(tempFile, testSrcName);
				if (await notExists(tempFile)) {
					throw new Error(
						"no write permissions - could not verify test file",
					);
				}
				await unlink(tempFile);
			} catch (e) {
				logger.debug(e);
				throw new Error("no write permissions");
			}
		}
		return true;
	} catch (e) {
		if (e.code === "ENOENT") {
			logger.error(
				`\tYour ${testSrcName} "${srcDir}" is not a valid directory on the filesystem: ${e.message}.`,
			);
			if (
				path.sep === "\\" &&
				!srcDir.includes("\\") &&
				!srcDir.includes("/")
			) {
				logger.error(
					"\tIt may not be formatted properly for Windows.\n" +
						'\t\t\t\tMake sure to use "\\\\" or "/" for directory separators.',
				);
			}
		} else {
			logger.error(
				`\tYour ${testSrcName} "${srcDir}" has invalid permissions: ${e.message}.`,
			);
		}
	}
	return false;
}

export async function countDirEntriesRec(
	dirs: string[],
	maxDataDepth: number,
): Promise<number> {
	if (maxDataDepth === 0) return 0;
	let count = 0;
	for (const dir of dirs) {
		const newDirs: string[] = [];
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			count++;
			if (entry.isDirectory()) newDirs.push(path.join(dir, entry.name));
		}
		count += await countDirEntriesRec(newDirs, maxDataDepth - 1);
	}
	return count;
}

// ================================ EXTENSIONS ================================

export function hasExt(files: File[], exts: string[]): boolean {
	return files.some((f) => exts.includes(path.extname(f.name.toLowerCase())));
}

export function stripExtension(filename: string): string {
	for (const ext of ALL_EXTENSIONS) {
		if (filename.endsWith(ext)) return path.basename(filename, ext);
	}
	return filename;
}

export function filesWithExt(files: File[], exts: string[]): File[] {
	return files.filter((f) =>
		exts.includes(path.extname(f.name.toLowerCase())),
	);
}

export async function findAFileWithExt(
	dir: string,
	exts: string[],
): Promise<string | null> {
	try {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isFile() && exts.includes(path.extname(fullPath))) {
				return fullPath;
			}
			if (entry.isDirectory()) {
				const file = await findAFileWithExt(fullPath, exts);
				if (file) return file;
			}
		}
	} catch (e) {
		logger.debug(e);
	}
	return null;
}

// =================================== TIME ===================================

export function nMsAgo(n: number): number {
	return Date.now() - n;
}

export function wait(n: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, n));
}

/**
 * Yield control to the event loop allowing all pending tasks to be processed
 * regardless of the current phase.
 * @param n Optional number of milliseconds to wait before yielding.
 */
export async function yieldToEventLoop(n: number = 0): Promise<void> {
	await wait(n);
	return new Promise((resolve) => setImmediate(resolve));
}

export async function time<R>(cb: () => Promise<R>, times: number[]) {
	const before = performance.now();
	try {
		return await cb();
	} finally {
		times.push(performance.now() - before);
	}
}

// ================================= LOGGING =================================

export function humanReadableDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString("sv");
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

export function getLogString(
	searchee: Searchee,
	color: ChalkInstance = chalk.reset,
) {
	if (searchee.title === searchee.name) {
		return searchee.infoHash || searchee.clientHost
			? `${color(searchee.title)} ${chalk.dim(`[${searchee.infoHash ? sanitizeInfoHash(searchee.infoHash) : ""}${searchee.clientHost ? `@${searchee.clientHost}` : ""}]`)}`
			: searchee.path
				? color(searchee.path)
				: color(searchee.title);
	}
	return searchee.infoHash || searchee.clientHost
		? `${color(searchee.title)} ${chalk.dim(`[${searchee.name} [${searchee.infoHash ? sanitizeInfoHash(searchee.infoHash) : ""}${searchee.clientHost ? `@${searchee.clientHost}` : ""}]]`)}`
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

/**
 * This cannot be done at the log level because of too many false positives.
 * The caller will need to extract the infoHash from their specific syntax.
 * @param infoHash The infoHash to sanitize
 */
export function sanitizeInfoHash(infoHash: string): string {
	return `${infoHash.slice(0, 8)}...`;
}

// ================================== TITLES ==================================

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
	const titlesA: string[] = getAllTitles(
		matchA
			? [matchA.groups?.title, matchA.groups?.altTitle].filter(isTruthy)
			: [a],
	)
		.map((title) => createKeyTitle(stripMetaFromName(title)))
		.filter(isTruthy);
	const titlesB: string[] = getAllTitles(
		matchB
			? [matchB.groups?.title, matchB.groups?.altTitle].filter(isTruthy)
			: [b],
	)
		.map((title) => createKeyTitle(stripMetaFromName(title)))
		.filter(isTruthy);
	const maxDistanceA = Math.floor(
		titlesA.reduce((sum, title) => sum + title.length, 0) /
			titlesA.length /
			LEVENSHTEIN_DIVISOR,
	);
	const maxDistanceB = Math.floor(
		titlesB.reduce((sum, title) => sum + title.length, 0) /
			titlesB.length /
			LEVENSHTEIN_DIVISOR,
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

export function cleanseSeparators(str: string): string {
	return str
		.replace(ALL_SQUARE_BRACKETS_REGEX, "") // bracketed text
		.replace(/[._()[\]]/g, " ") // release delimiters (except '-')
		.replace(ALL_SPACES_REGEX, " ") // normalize spaces
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
					.replace(ALL_SPACES_REGEX, " ")
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

/**
 * Generates possible anime search queries from a given name.
 * Only use if getMediaType returns anime as it's conditional on a few factors.
 * @param stem The name without extension to generate queries from.
 * @returns An array of possible search queries.
 */
export function getAnimeQueries(stem: string): string[] {
	const animeQueries: string[] = [];
	const { title, altTitle, release } = stem.match(ANIME_REGEX)?.groups ?? {};
	if (title) {
		const strippedTitle = cleanTitle(title);
		animeQueries.push(
			`${strippedTitle.length ? strippedTitle : title} ${release}`,
		);
	}
	if (altTitle) {
		if (isBadTitle(altTitle)) return animeQueries;
		const strippedAltTitle = cleanTitle(altTitle);
		animeQueries.push(
			`${strippedAltTitle.length ? strippedAltTitle : altTitle} ${release}`,
		);
	}
	return animeQueries;
}

/**
 * Generates possible video search queries from a given name.
 * Only use if getMediaType returns video as it's conditional on a few factors.
 * @param stem The name without extension to generate queries from.
 * @returns An array of possible search queries.
 */
export function getVideoQueries(stem: string): string[] {
	// Anime that fails MediaType.ANIME often has `[group] Title (Extra Info)`
	const noParentheses = cleanTitle(
		stripMetaFromName(
			stem
				.replace(ALL_PARENTHESES_REGEX, "")
				.replace(ALL_SPACES_REGEX, " ")
				.trim(),
		),
	);
	if (noParentheses.length >= MIN_VIDEO_QUERY_LENGTH) return [noParentheses];

	let videoQuery = cleanTitle(stripMetaFromName(stem));
	if (videoQuery.length) return [videoQuery];
	videoQuery = stripMetaFromName(stem);
	if (videoQuery.length) return [videoQuery];
	return [stem];
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

// =================================== URLS ===================================

export function sanitizeUrl(url: string | URL): string {
	if (typeof url === "string") {
		url = new URL(url);
	}
	return url.origin + url.pathname;
}

export function getApikey(url: string) {
	return new URL(url).searchParams.get("apikey");
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

// ================================ FUNCTIONAL ================================

export const tap = (fn) => (value) => {
	fn(value);
	return value;
};

export function fallback<T>(...args: T[]): T | undefined {
	for (const arg of args) {
		if (arg !== undefined) return arg;
	}
	return undefined;
}

export function findFallback<T, U>(
	arr: T[],
	items: U[],
	cb: (e: T, item: U) => boolean,
): T | undefined {
	for (const item of items) {
		const found = arr.find((e) => cb(e, item));
		if (found) return found;
	}
	return undefined;
}

export async function inBatches<T>(
	items: T[],
	cb: (batch: T[]) => Promise<void>,
	options = { batchSize: 100 },
): Promise<void> {
	for (let i = 0; i < items.length; i += options.batchSize) {
		await cb(items.slice(i, i + options.batchSize));
	}
}

export async function fromBatches<T, R>(
	items: T[],
	cb: (batch: T[]) => Promise<R[]>,
	options = { batchSize: 100 },
): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += options.batchSize) {
		results.push(...(await cb(items.slice(i, i + options.batchSize))));
	}
	return results;
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

// ================================== ASYNC ==================================

export async function filterAsync<T>(
	arr: T[],
	predicate: (e: T) => Promise<boolean>,
): Promise<T[]> {
	const results = await mapAsync(arr, predicate);
	return arr.filter((_, index) => results[index]);
}

/**
 * Filters an array asynchronously in batches, yielding to the event loop
 * between batches to avoid blocking the event loop for too long.
 * @param arr The array to filter.
 * @param predicate The asynchronous predicate function to test each element.
 * @param options.batchSize The size of each batch to process.
 * @returns A promise that resolves to an array of elements that satisfy the predicate.
 */
export async function filterAsyncYield<T>(
	arr: T[],
	predicate: (e: T) => Promise<boolean>,
	options = { batchSize: 1000 },
): Promise<T[]> {
	const results = await fromBatches(
		arr,
		async (batch) => {
			await yieldToEventLoop();
			return Promise.all(batch.map(predicate));
		},
		options,
	);
	return arr.filter((_, index) => results[index]);
}

export async function mapAsync<T, R>(
	arr: T[],
	cb: (e: T) => Promise<R>,
): Promise<R[]> {
	return fromBatches(arr, async (batch) => Promise.all(batch.map(cb)), {
		batchSize: 10000,
	});
}

export async function flatMapAsync<T, R>(
	arr: T[],
	cb: (e: T) => Promise<R[]>,
): Promise<R[]> {
	return (await mapAsync(arr, cb)).flat();
}

export async function reduceAsync<T, R>(
	arr: T[],
	cb: (acc: R, cur: T, index: number, arr: T[]) => Promise<R>,
	initialValue: R,
): Promise<R> {
	let accumulator = initialValue;
	for (let index = 0; index < arr.length; index++) {
		accumulator = await cb(accumulator, arr[index], index, arr);
	}
	return accumulator;
}

export async function findAsync<T>(
	it: Iterable<T>,
	cb: (e: T) => Promise<boolean>,
): Promise<T | undefined> {
	for (const item of it) {
		if (await cb(item)) return item;
	}
	return undefined;
}

export async function someAsync<T>(
	it: Iterable<T>,
	cb: (e: T) => Promise<boolean>,
): Promise<boolean> {
	for (const item of it) {
		if (await cb(item)) return true;
	}
	return false;
}

export async function everyAsync<T>(
	it: Iterable<T>,
	cb: (e: T) => Promise<boolean>,
): Promise<boolean> {
	for (const item of it) {
		if (!(await cb(item))) return false;
	}
	return true;
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

// ================================= STRINGS =================================

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
	const lastMatchIndex = lastMatch.index;
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

export function getPathParts(
	pathStr: string,
	dirnameFunc = path.dirname,
): string[] {
	const parts: string[] = [];
	let parent = pathStr;
	while (parent !== ".") {
		parts.unshift(path.basename(parent));
		const newParent = dirnameFunc(parent);
		if (newParent === parent) {
			parts.shift();
			break;
		}
		parent = newParent;
	}
	return parts;
}

// ================================== MUTEX ==================================

export enum Mutex {
	INDEX_TORRENTS_AND_DATA_DIRS = "INDEX_TORRENTS_AND_DATA_DIRS",
	CHECK_JOBS = "CHECK_JOBS",
	CREATE_ALL_SEARCHEES = "CREATE_ALL_SEARCHEES",
	GUID_INFO_HASH_MAP = "GUID_INFO_HASH_MAP",
	CLIENT_INJECTION = "CLIENT_INJECTION",
}
const mutexes = new Map<Mutex, Promise<unknown>>();

/**
 * Executes a callback function within a mutex for the given name.
 * @param name The name of the mutex to create/use.
 * @param options.useQueue If false, concurrent calls will share the pending result.
 * @param cb The callback to execute.
 * @returns The result of the callback.
 */
export async function withMutex<T>(
	name: Mutex,
	options: { useQueue: boolean },
	cb: () => Promise<T>,
): Promise<T> {
	const existingMutex = mutexes.get(name) as Promise<T> | undefined;
	if (existingMutex) {
		if (options.useQueue) {
			while (mutexes.has(name)) await mutexes.get(name);
		} else {
			return existingMutex;
		}
	}
	const mutex = (async () => {
		try {
			return await cb();
		} finally {
			mutexes.delete(name);
		}
	})();
	mutexes.set(name, mutex);
	return mutex;
}

/**
 * An async safe semaphore implementation that preserves FIFO order.
 * It uses an id for release to allow multiple releases (e.g try/finally with early releases).
 * @param options.permits The number of concurrent permits.
 * @param options.lifetimeMs Maximum lifetime of an acquire before automatic release.
 */
export class AsyncSemaphore {
	private permits: number;
	private lifetimeMs?: number;
	private acquired: Set<number> = new Set();
	private timers: Map<number, NodeJS.Timeout> = new Map();
	private waiting: ((id: number) => void)[] = [];
	private counter: number = 0;
	private getNextId = () => {
		if (this.counter === Number.MAX_SAFE_INTEGER) this.counter = 0;
		return ++this.counter;
	};

	constructor(options: { permits: number; lifetimeMs?: number }) {
		this.permits = Math.floor(options.permits);
		if (this.permits <= 0) {
			throw new Error("Permits count must be positive");
		}
		this.lifetimeMs = options.lifetimeMs;
		if (this.lifetimeMs && this.lifetimeMs <= 0) {
			throw new Error("Lifetime must be positive");
		}
	}

	acquire(): Promise<number> {
		return new Promise<number>((resolve) => {
			if (this.permits > 0) {
				this.permits--;
				const id = this.getNextId();
				this.acquired.add(id);
				if (this.lifetimeMs) {
					this.timers.set(
						id,
						setTimeout(() => this.release(id), this.lifetimeMs),
					);
				}
				resolve(id);
			} else {
				this.waiting.push(resolve);
			}
		});
	}

	release(id: number): void {
		if (!this.acquired.has(id)) return;
		this.acquired.delete(id);
		clearTimeout(this.timers.get(id));
		this.timers.delete(id);

		if (this.waiting.length > 0) {
			const newId = this.getNextId();
			this.acquired.add(newId);
			if (this.lifetimeMs) {
				this.timers.set(
					newId,
					setTimeout(() => this.release(newId), this.lifetimeMs),
				);
			}
			this.waiting.shift()!(newId);
		} else {
			this.permits++;
		}
	}
}
