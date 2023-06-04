import fs, { promises as fsPromises, readdirSync } from "fs";
import Fuse from "fuse.js";
import parseTorrent, { Metafile } from "parse-torrent";
import path, { join } from "path";
import { inspect } from "util";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import { logger, logOnce } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { createSearcheeFromTorrentFile, Searchee } from "./searchee.js";
import { stripExtension } from "./utils.js";
import fetch, { Response } from "node-fetch";

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
	return parseTorrent(data);
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
			headers: { "User-Agent": "cross-seed" },
			signal: abortController.signal,
			redirect: "manual",
		});
	} catch (e) {
		if (e.name === "AbortError") {
			logger.error(`snatching ${url} timed out`);
			return resultOfErr(SnatchError.ABORTED);
		}
		logger.error(`failed to access ${url}`);
		logger.debug(e);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	}

	if (
		response.status.toString().startsWith("3") &&
		response.headers.get("location")?.startsWith("magnet:")
	) {
		logger.error(`Unsupported: magnet link detected at ${url}`);
		return resultOfErr(SnatchError.MAGNET_LINK);
	} else if (response.status === 429) {
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
			parseTorrent(
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
	info: Metafile
): void {
	const { outputDir } = getRuntimeConfig();
	const buf = parseTorrent.toTorrentFile(info);
	const name = stripExtension(info.name);
	const filename = `[${tag}][${tracker}]${name}.torrent`;
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
	// @ts-expect-error fuse types are confused
	const potentialMatches = new Fuse(allNames, {
		keys: ["name"],
		distance: 6,
		threshold: 0.25,
	}).search(name);

	if (potentialMatches.length === 0) return null;
	const [firstMatch] = potentialMatches;
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

export function isSingleFileTorrent(meta: Metafile): boolean {
	return !meta.info.files;
}
