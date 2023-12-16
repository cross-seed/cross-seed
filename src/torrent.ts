import fs, { promises as fsPromises } from "fs";
import Fuse from "fuse.js";
import fetch, { Response } from "node-fetch";
import path, { join } from "path";
import { inspect } from "util";
import { USER_AGENT } from "./constants.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import { logger, logOnce } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { createSearcheeFromTorrentFile, Searchee } from "./searchee.js";
import { reformatTitleForSearching, stripExtension } from "./utils.js";

export interface TorrentLocator {
	infoHash?: string;
	name?: string;
	path?: string;
}

export enum SnatchError {
	ABORTED = "ABORTED",
	RATE_LIMITED = "RATE_LIMITED",
	MAGNET_LINK = "MAGNET_LINK",
	INVALID_CONTENTS = "INVALID_CONTENTS",
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export async function parseTorrentFromFilename(
	filename: string
): Promise<Metafile> {
	const data = await fsPromises.readFile(filename);
	return Metafile.decode(data);
}

function isMagnetRedirectError(error: Error): boolean {
	return (
		// node-fetch
		error.message.includes('URL scheme "magnet" is not supported.') ||
		// undici
		// @ts-expect-error error causes "not supported yet"
		error?.cause.message.includes("URL scheme must be a HTTP(S) scheme")
	);
}

export async function parseTorrentFromURL(
	url: string
): Promise<Result<Metafile, SnatchError>> {
	const abortController = new AbortController();
	const { snatchTimeout } = getRuntimeConfig();

	if (typeof snatchTimeout === "number") {
		setTimeout(() => void abortController.abort(), snatchTimeout).unref();
	}

	let response: Response;
	try {
		response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: abortController.signal,
		});
	} catch (e) {
		if (e.name === "AbortError") {
			logger.error(`snatching ${url} timed out`);
			return resultOfErr(SnatchError.ABORTED);
		} else if (isMagnetRedirectError(e)) {
			logger.error(`Unsupported: magnet link detected at ${url}`);
			return resultOfErr(SnatchError.MAGNET_LINK);
		}
		logger.error(`failed to access ${url}`);
		logger.debug(e);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	}

	if (response.status === 429) {
		return resultOfErr(SnatchError.RATE_LIMITED);
	} else if (!response.ok) {
		logger.error(
			`error downloading torrent at ${url}: ${response.status} ${response.statusText}`
		);
		logger.debug("response: %s", await response.text());
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	} else if (response.headers.get("Content-Type") === "application/rss+xml") {
		const responseText = await response.clone().text();
		if (responseText.includes("429")) {
			return resultOfErr(SnatchError.RATE_LIMITED);
		}
		logger.error(`invalid torrent contents at ${url}`);
		logger.debug(
			`contents: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`
		);
		return resultOfErr(SnatchError.INVALID_CONTENTS);
	}
	try {
		return resultOf(
			Metafile.decode(
				Buffer.from(new Uint8Array(await response.arrayBuffer()))
			)
		);
	} catch (e) {
		logger.error(`invalid torrent contents at ${url}`);
		const contentType = response.headers.get("Content-Type");
		const contentLength = response.headers.get("Content-Length");
		logger.debug(`Content-Type: ${contentType}`);
		logger.debug(`Content-Length: ${contentLength}`);
		return resultOfErr(SnatchError.INVALID_CONTENTS);
	}
}

export function saveTorrentFile(
	tracker: string,
	tag = "",
	meta: Metafile
): void {
	const { outputDir } = getRuntimeConfig();
	const buf = meta.encode();
	const filename = `[${tag}][${tracker}]${stripExtension(
		meta.getFileSystemSafeName()
	)}.torrent`;
	fs.writeFileSync(path.join(outputDir, filename), buf, { mode: 0o644 });
}

export async function findAllTorrentFilesInDir(
	torrentDir: string
): Promise<string[]> {
	return (await fsPromises.readdir(torrentDir))
		.filter((fn) => path.extname(fn) === ".torrent")
		.sort()
		.map((fn) => path.resolve(path.join(torrentDir, fn)));
}

export async function indexNewTorrents(): Promise<void> {
	const { torrentDir } = getRuntimeConfig();
	const dirContents = await findAllTorrentFilesInDir(torrentDir);
	// index new torrents in the torrentDir

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
	// clean up torrents that no longer exist in the torrentDir
	// this might be a slow query
	await db("torrent").whereNotIn("file_path", dirContents).del();
}

export async function getInfoHashesToExclude(): Promise<string[]> {
	return (await db("torrent").select({ infoHash: "info_hash" })).map(
		(t) => t.infoHash
	);
}

export async function validateTorrentDir(): Promise<void> {
	const { torrentDir } = getRuntimeConfig();
	try {
		await fsPromises.readdir(torrentDir);
	} catch (e) {
		throw new CrossSeedError(`Torrent dir ${torrentDir} is invalid`);
	}
}

export async function loadTorrentDirLight(): Promise<Searchee[]> {
	const { torrentDir } = getRuntimeConfig();
	const torrentFilePaths = fs
		.readdirSync(torrentDir)
		.filter((fn) => path.extname(fn) === ".torrent")
		.sort()
		.map((filename) => join(getRuntimeConfig().torrentDir, filename));

	const searchees: Searchee[] = [];
	for (const torrentFilePath of torrentFilePaths) {
		const searcheeResult = await createSearcheeFromTorrentFile(
			torrentFilePath
		);
		if (searcheeResult.isOk()) {
			searchees.push(searcheeResult.unwrapOrThrow());
		}
	}
	return searchees;
}

export async function getTorrentByFuzzyName(
	name: string
): Promise<null | Metafile> {
	const allNames = await db("torrent").select("name", "file_path");
	const fullMatch = reformatTitleForSearching(name)
		.replace(/[^a-z0-9]/gi, "")
		.toLowerCase();

	// Attempt to filter torrents in DB to match incoming torrent before fuzzy check
	let filteredNames = [];
	if (fullMatch) {
		filteredNames = allNames.filter((dbName) => {
			const dbMatch = reformatTitleForSearching(dbName.name)
				.replace(/[^a-z0-9]/gi, "")
				.toLowerCase();
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

	// Valid matches exist
	if (potentialMatches.length === 0) return null;

	const firstMatch = potentialMatches[0];
	return parseTorrentFromFilename(firstMatch.item.file_path);
}

export async function getTorrentByCriteria(
	criteria: TorrentLocator
): Promise<Metafile> {
	const findResult = await db("torrent")
		.where((b) => {
			// there is always at least one criterion
			if (criteria.infoHash) {
				b = b.where({ info_hash: criteria.infoHash });
			}
			if (criteria.name) {
				b = b.where({ name: criteria.name });
			}
			return b;
		})
		.first();

	if (findResult === undefined) {
		const message = `could not find a torrent with the criteria ${inspect(
			criteria
		)}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult.file_path);
}
