import fs, { promises as fsPromises } from "fs";
import parseTorrent, { Metafile } from "parse-torrent";
import path from "path";
import { concat } from "simple-get";
import { INDEXED_TORRENTS } from "./constants";
import db from "./db";
import { CrossSeedError } from "./errors";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";
import { createSearcheeFromTorrentFile, Searchee } from "./searchee";
import { ok, stripExtension } from "./utils";

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
			concat({ url, followRedirects: false }, (err, res, data) => {
				if (err) return reject(err);
				res.data = data;
				return resolve(res);
			});
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
			response.headers.location &&
			response.headers.location.startsWith("magnet:")
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

	for (const filepath of dirContents) {
		const doesAlreadyExist = db
			.get(INDEXED_TORRENTS)
			.find((indexEntry) => indexEntry.filepath === filepath)
			.value();
		if (!doesAlreadyExist) {
			let meta;
			try {
				meta = await parseTorrentFromFilename(filepath);
			} catch (e) {
				logger.error(`Failed to parse ${filepath}`);
				logger.debug(e);
				continue;
			}
			db.get(INDEXED_TORRENTS).value().push({
				filepath,
				infoHash: meta.infoHash,
				name: meta.name,
			});
		}
	}
	db.set(
		INDEXED_TORRENTS,
		db
			.get(INDEXED_TORRENTS)
			.value()
			.filter((e) => dirContents.includes(e.filepath))
	).value();
	db.write();
}

export function getInfoHashesToExclude(): string[] {
	return db
		.get(INDEXED_TORRENTS)
		.value()
		.map((t) => t.infoHash);
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
	return Promise.all(
		fs
			.readdirSync(torrentDir)
			.filter((fn) => path.extname(fn) === ".torrent")
			.sort()
			.map(createSearcheeFromTorrentFile)
	).then((searcheeResults) => searcheeResults.filter(ok));
}

export async function getTorrentByName(name: string): Promise<Metafile> {
	await indexNewTorrents();
	const findResult = db
		.get(INDEXED_TORRENTS)
		.value()
		.find((e) => e.name === name);
	if (findResult === undefined) {
		const message = `could not find a torrent with the name ${name}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult.filepath);
}

export async function getTorrentByHash(hash: string): Promise<Metafile> {
	await indexNewTorrents();
	const findResult = db
		.get(INDEXED_TORRENTS)
		.value()
		.find((e) => e.infoHash === hash);
	if (findResult === undefined) {
		const message = `could not find a torrent with the hash ${hash}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult.filepath);
}
