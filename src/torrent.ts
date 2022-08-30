import fs, { promises as fsPromises } from "fs";
import Fuse from "fuse.js";
import parseTorrent, { Metafile } from "parse-torrent";
import path, { join } from "path";
import simpleGet from "simple-get";
import { inspect } from "util";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";
import { logger, logOnce } from "./logger.js";
import { getRuntimeConfig, NonceOptions } from "./runtimeConfig.js";
import { createSearcheeFromTorrentFile, Searchee } from "./searchee.js";
import { ok, stripExtension } from "./utils.js";

export interface TorrentLocator {
	infoHash?: string;
	name?: string;
}

export async function parseTorrentFromFilename(
	filename: string
): Promise<Metafile> {
	const data = await fsPromises.readFile(filename);
	return parseTorrent(data);
}

export async function parseTorrentFromURL(url: string): Promise<Metafile> {
	let response;
	try {
		response = await new Promise((resolve, reject) => {
			simpleGet.concat(
				{ url, followRedirects: false },
				(err, res, data) => {
					if (err) return reject(err);
					res.data = data;
					return resolve(res);
				}
			);
		});
	} catch (e) {
		logger.error(`failed to access ${url}`);
		logger.debug(e);
		return null;
	}

	if (response.statusCode < 200 || response.statusCode >= 300) {
		if (
			response.statusCode >= 300 &&
			response.statusCode < 400 &&
			response.headers.location?.startsWith("magnet:")
		) {
			logger.error(`Unsupported: magnet link detected at ${url}`);
			return null;
		} else {
			logger.error(
				`error downloading torrent at ${url}: ${response.statusCode} ${response.statusMessage}`
			);
			logger.debug("response: %s", response.data);
			logger.debug("headers: %s", response.headers);
			return null;
		}
	}

	try {
		return parseTorrent(response.data);
	} catch (e) {
		logger.error(`invalid torrent contents at ${url}`);
		logger.debug(e);
		return null;
	}
}

export function saveTorrentFile(
	tracker: string,
	tag = "",
	info: Metafile,
	nonceOptions: NonceOptions
): void {
	const { outputDir: runtimeConfigOutputDir } = getRuntimeConfig();
	const { outputDir = runtimeConfigOutputDir } = nonceOptions;
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
			await db("torrent").insert({
				file_path: filepath,
				info_hash: meta.infoHash,
				name: meta.name,
			});
		}
	}
	// clean up torrents that no longer exist in the torrentDir
	// this might be a slow query
	await db("torrent").whereNotIn("file_path", dirContents).del();
}

export async function getInfoHashesToExclude(): Promise<string[]> {
	return (await db("torrent").select("info_hash")).map((t) => t.info_hash);
	// return db.data.indexedTorrents.map((t) => t.infoHash);
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
		if (ok(searcheeResult)) searchees.push(searcheeResult);
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
