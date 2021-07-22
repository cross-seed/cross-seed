import fs, { promises as fsPromises } from "fs";
import parseTorrent, { Metafile } from "parse-torrent";
import path from "path";
import { concat } from "simple-get";
import { CrossSeedError } from "./errors";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";
import { ok, stripExtension } from "./utils";
import { createSearcheeFromTorrentFile, Searchee } from "./searchee";

export async function parseTorrentFromFilename(
	filename: string
): Promise<Metafile> {
	const data = await fsPromises.readFile(filename);
	return parseTorrent(data);
}

export function parseTorrentFromFilenameSync(filename: string): Metafile {
	const data = fs.readFileSync(filename);
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
		logger.error(`error: failed to access ${url}`);
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
		logger.error(`error: invalid torrent contents at ${url}`);
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

export function findAllTorrentFilesInDir(torrentDir: string): string[] {
	return fs
		.readdirSync(torrentDir)
		.sort()
		.filter((fn) => path.extname(fn) === ".torrent")
		.map((fn) => path.join(torrentDir, fn));
}

export async function indexTorrents(): Promise<void> {
	const { torrentDir } = getRuntimeConfig();
	const contents = await fsPromises.readdir(torrentDir);
	const searchees = contents
		.filter((fn) => path.extname(fn) === ".torrent")
		.sort()
		.map(createSearcheeFromTorrentFile)
		.filter(ok);
}

// this is rtorrent specific
export function getInfoHashesToExclude(): string[] {
	const { torrentDir } = getRuntimeConfig();
	return findAllTorrentFilesInDir(torrentDir).map((pathname) =>
		path.basename(pathname, ".torrent").toLowerCase()
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
	return Promise.all(
		fs
			.readdirSync(torrentDir)
			.filter((fn) => path.extname(fn) === ".torrent")
			.sort()
			.map(createSearcheeFromTorrentFile)
	).then((searcheeResults) => searcheeResults.filter(ok));
}

export async function getTorrentByName(name: string): Promise<Metafile> {
	const { torrentDir } = getRuntimeConfig();
	const dirContents = findAllTorrentFilesInDir(torrentDir);
	const findResult = dirContents.find((filename) => {
		const meta = parseTorrentFromFilenameSync(filename);
		return meta.name === name;
	});
	if (findResult === undefined) {
		const message = `could not find a torrent with the name ${name}`;
		throw new Error(message);
	}
	return parseTorrentFromFilename(findResult);
}
