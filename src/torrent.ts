import { distance } from "fastest-levenshtein";
import fs from "fs";
import { readdir, readFile, writeFile } from "fs/promises";
import Fuse from "fuse.js";
import { extname, join, resolve } from "path";
import { inspect } from "util";
import {
	LEVENSHTEIN_DIVISOR,
	SAVED_TORRENTS_INFO_REGEX,
	USER_AGENT,
} from "./constants.js";
import { db } from "./db.js";
import { logger, logOnce } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromTorrentFile,
	getAnimeKeys,
	getEpisodeKey,
	getMovieKey,
	getSeasonKey,
	Searchee,
} from "./searchee.js";
import { createKeyTitle, MediaType, stripExtension } from "./utils.js";

export interface TorrentLocator {
	infoHash?: string;
	path?: string;
}

export interface FilenameMetadata {
	name: string;
	mediaType: string;
	tracker: string;
}

export enum SnatchError {
	ABORTED = "ABORTED",
	RATE_LIMITED = "RATE_LIMITED",
	MAGNET_LINK = "MAGNET_LINK",
	INVALID_CONTENTS = "INVALID_CONTENTS",
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export async function parseTorrentFromFilename(
	filename: string,
): Promise<Metafile> {
	const data = await readFile(filename);
	return Metafile.decode(data);
}

function isMagnetRedirectError(error: Error): boolean {
	return (
		// node-fetch
		error.message.includes('URL scheme "magnet" is not supported.') ||
		// undici
		Boolean(
			(error.cause as Error | undefined)?.message.includes(
				"URL scheme must be a HTTP(S) scheme",
			),
		)
	);
}

export async function snatch(
	candidate: Candidate,
): Promise<Result<Metafile, SnatchError>> {
	const { snatchTimeout } = getRuntimeConfig();
	const url = candidate.link;
	const tracker = candidate.tracker;

	let response: Response;
	try {
		response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal:
				typeof snatchTimeout === "number"
					? AbortSignal.timeout(snatchTimeout)
					: undefined,
		});
	} catch (e) {
		if (e.name === "AbortError" || e.name === "TimeoutError") {
			logger.error(
				`Snatch timed out from ${tracker} for ${candidate.name}`,
			);
			logger.debug(`${candidate.name}: ${url}`);
			return resultOfErr(SnatchError.ABORTED);
		} else if (isMagnetRedirectError(e)) {
			logger.verbose(
				`Unsupported: magnet link detected from ${tracker} for ${candidate.name}`,
			);
			logger.debug(`${candidate.name}: ${url}`);
			return resultOfErr(SnatchError.MAGNET_LINK);
		}
		logger.error(`Failed to access ${tracker} for ${candidate.name}`);
		logger.debug(`${candidate.name}: ${url}`);
		logger.debug(e);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	}

	if (response.status === 429) {
		return resultOfErr(SnatchError.RATE_LIMITED);
	} else if (!response.ok) {
		logger.error(
			`Error downloading torrent from ${tracker} for ${candidate.name}: ${response.status} ${response.statusText}`,
		);
		const responseText = await response.clone().text();
		logger.debug(
			`${candidate.name}: ${url} - Response: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`,
		);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	} else if (response.headers.get("Content-Type") === "application/rss+xml") {
		const responseText = await response.clone().text();
		logger.error(
			`Invalid torrent contents from ${tracker} for ${candidate.name}`,
		);
		logger.debug(
			`${candidate.name}: ${url} - Contents: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`,
		);
		return resultOfErr(SnatchError.INVALID_CONTENTS);
	}
	try {
		return resultOf(
			Metafile.decode(
				Buffer.from(new Uint8Array(await response.arrayBuffer())),
			),
		);
	} catch (e) {
		logger.error(
			`Invalid torrent contents from ${tracker} for ${candidate.name}`,
		);
		const contentType = response.headers.get("Content-Type");
		const contentLength = response.headers.get("Content-Length");
		logger.debug(
			`${candidate.name}: ${url} - Content-Type: ${contentType} - Content-Length: ${contentLength}`,
		);
		logger.debug(e);
		return resultOfErr(SnatchError.INVALID_CONTENTS);
	}
}

export async function saveTorrentFile(
	tracker: string,
	tag: string,
	meta: Metafile,
): Promise<void> {
	const { outputDir } = getRuntimeConfig();
	const buf = meta.encode();
	// Be sure to update parseInfoFromSavedTorrent if changing the format
	const filePath = join(
		outputDir,
		`[${tag}][${tracker}]${stripExtension(
			meta.getFileSystemSafeName(),
		)}[${meta.infoHash}].torrent`,
	);
	if (fs.existsSync(filePath)) {
		fs.utimesSync(filePath, new Date(), fs.statSync(filePath).mtime);
		return;
	}
	await writeFile(filePath, buf, { mode: 0o644 });
}

export function parseMetadataFromFilename(
	filename: string,
): Partial<FilenameMetadata> {
	const match = filename.match(SAVED_TORRENTS_INFO_REGEX);
	if (!match) {
		return {};
	}
	const mediaType = match.groups!.mediaType;
	if (!Object.values(MediaType).includes(mediaType as MediaType)) {
		return {};
	}
	const tracker = match.groups!.tracker;
	const name = match.groups!.name;
	return { name, mediaType, tracker };
}

export async function findAllTorrentFilesInDir(
	torrentDir: string,
): Promise<string[]> {
	return (await readdir(torrentDir))
		.filter((fn) => extname(fn) === ".torrent")
		.sort()
		.map((fn) => resolve(join(torrentDir, fn)));
}

export async function indexNewTorrents(): Promise<void> {
	const { torrentDir } = getRuntimeConfig();
	if (typeof torrentDir !== "string") return;

	const dirContents = new Set(await findAllTorrentFilesInDir(torrentDir));

	// Index new torrents in the torrentDir
	for (const filepath of dirContents) {
		const doesAlreadyExist = await db("torrent")
			.select("id")
			.where({ file_path: filepath })
			.first();

		if (!doesAlreadyExist) {
			let meta;
			try {
				meta = await parseTorrentFromFilename(filepath);
			} catch (e) {
				logOnce(`Failed to parse ${filepath}`, () => {
					logger.error(`Failed to parse ${filepath}`);
					logger.debug(e);
				});
				continue;
			}
			await db("torrent")
				.insert({
					file_path: filepath,
					info_hash: meta.infoHash,
					name: meta.name,
				})
				.onConflict("file_path")
				.ignore();
		}
	}

	const dbFiles = await db("torrent").select({ filePath: "file_path" });
	const dbFilePaths: string[] = dbFiles.map((row) => row.filePath);

	const filesToDelete = dbFilePaths.filter(
		(filePath) => !dirContents.has(filePath),
	);

	const batchSize = 1000;
	for (let i = 0; i < filesToDelete.length; i += batchSize) {
		const batch = filesToDelete.slice(i, i + batchSize);
		await db("torrent").whereIn("file_path", batch).del();
	}
}

export async function getInfoHashesToExclude(): Promise<string[]> {
	return (await db("torrent").select({ infoHash: "info_hash" })).map(
		(t) => t.infoHash,
	);
}

export async function loadTorrentDirLight(
	torrentDir: string,
): Promise<Searchee[]> {
	const torrentFilePaths = await findAllTorrentFilesInDir(torrentDir);

	const searchees: Searchee[] = [];
	for (const torrentFilePath of torrentFilePaths) {
		const searcheeResult =
			await createSearcheeFromTorrentFile(torrentFilePath);
		if (searcheeResult.isOk()) {
			searchees.push(searcheeResult.unwrap());
		}
	}
	return searchees;
}

function getKeysFromName(name: string): {
	keyTitles: string[];
	element?: string | number;
	useFallback: boolean;
} {
	const stem = stripExtension(name);
	const episodeKey = getEpisodeKey(stem);
	if (episodeKey) {
		const keyTitles = [episodeKey.keyTitle];
		const element = `${episodeKey.season ? `${episodeKey.season}.` : ""}${episodeKey.episode}`;
		return { keyTitles, element, useFallback: false };
	}
	const seasonKey = getSeasonKey(stem);
	if (seasonKey) {
		const keyTitles = [seasonKey.keyTitle];
		const element = seasonKey.season;
		return { keyTitles, element, useFallback: false };
	}
	const movieKey = getMovieKey(stem);
	if (movieKey) {
		const keyTitles = [movieKey.keyTitle];
		return { keyTitles, useFallback: false };
	}
	const animeKeys = getAnimeKeys(stem);
	if (animeKeys) {
		const keyTitles = animeKeys.keyTitles;
		const element = animeKeys.release;
		return { keyTitles, element, useFallback: true };
	}
	return { keyTitles: [], useFallback: true };
}

export async function getSimilarTorrentsByName(
	name: string,
): Promise<{ keys: string[]; metas: Metafile[] }> {
	const { keyTitles, element, useFallback } = getKeysFromName(name);
	const metas = useFallback ? await getTorrentByFuzzyName(name) : [];
	if (!keyTitles.length) {
		return { keys: [], metas };
	}
	const candidateMaxDistance = Math.floor(
		Math.max(...keyTitles.map((keyTitle) => keyTitle.length)) /
			LEVENSHTEIN_DIVISOR,
	);

	const allEntries: { name: string; file_path: string }[] = await db(
		"torrent",
	).select("name", "file_path");
	const filteredEntries = allEntries.filter((dbName) => {
		const entry = getKeysFromName(dbName.name);
		if (entry.element !== element) return false;
		if (!entry.keyTitles.length) return false;
		const maxDistance = Math.max(
			candidateMaxDistance,
			Math.floor(
				Math.max(
					...entry.keyTitles.map((keyTitle) => keyTitle.length),
				) / LEVENSHTEIN_DIVISOR,
			),
		);
		return entry.keyTitles.some((dbKeyTitle) => {
			return keyTitles.some(
				(keyTitle) => distance(keyTitle, dbKeyTitle) <= maxDistance,
			);
		});
	});

	const keys = element
		? keyTitles.map((keyTitle) => `${keyTitle}.${element}`)
		: keyTitles;
	metas.push(
		...(await Promise.all(
			filteredEntries.map(async (dbName) => {
				return parseTorrentFromFilename(dbName.file_path);
			}),
		)),
	);
	return { keys, metas };
}

export async function getTorrentByFuzzyName(name: string): Promise<Metafile[]> {
	const allNames: { name: string; file_path: string }[] = await db(
		"torrent",
	).select("name", "file_path");
	const fullMatch = createKeyTitle(name);

	// Attempt to filter torrents in DB to match incoming torrent before fuzzy check
	let filteredNames: typeof allNames = [];
	if (fullMatch) {
		filteredNames = allNames.filter((dbName) => {
			const dbMatch = createKeyTitle(dbName.name);
			if (!dbMatch) return false;
			return fullMatch === dbMatch;
		});
	}

	// If none match, proceed with fuzzy name check on all names.
	filteredNames = filteredNames.length > 0 ? filteredNames : allNames;

	// @ts-expect-error fuse types are confused
	const potentialMatches = new Fuse(filteredNames, {
		keys: ["name"],
		distance: 6,
		threshold: 0.25,
	}).search(name);
	if (potentialMatches.length === 0) return [];
	return [await parseTorrentFromFilename(potentialMatches[0].item.file_path)];
}

export async function getTorrentByCriteria(
	criteria: TorrentLocator,
): Promise<Metafile> {
	const findResult = await db("torrent")
		.where((b) => b.where({ info_hash: criteria.infoHash }))
		.first();

	if (findResult === undefined) {
		const message = `torrentDir does not have any torrent with criteria ${inspect(
			criteria,
		)}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult.file_path);
}
