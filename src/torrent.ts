import { distance } from "fastest-levenshtein";
import bencode from "bencode";
import fs, { existsSync, statSync } from "fs";
import { readdir, readFile, writeFile } from "fs/promises";
import Fuse from "fuse.js";
import { extname, join, resolve } from "path";
import { inspect } from "util";
import {
	getClient,
	TorrentMetadataInClient,
	validateClientSavePaths,
} from "./clients/TorrentClient.js";
import {
	LEVENSHTEIN_DIVISOR,
	MediaType,
	SAVED_TORRENTS_INFO_REGEX,
	USER_AGENT,
} from "./constants.js";
import { db, memDB } from "./db.js";
import { Label, logger, logOnce } from "./logger.js";
import { Metafile, updateMetafileMetadata } from "./parseTorrent.js";
import { Candidate } from "./pipeline.js";
import { isOk, Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromDB,
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	File,
	getAbsoluteFilePath,
	getAnimeKeys,
	getEpisodeKey,
	getLargestFile,
	getMovieKey,
	getSeasonKey,
	getSourceRoot,
	SearcheeLabel,
	SearcheeWithInfoHash,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import {
	getLogString,
	inBatches,
	isTruthy,
	Mutex,
	stripExtension,
	withMutex,
} from "./utils.js";
import {
	getDataByFuzzyName,
	indexDataDirs,
	shouldIgnorePathHeuristically,
} from "./dataFiles.js";

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

export interface EnsembleEntry {
	path: string;
	info_hash: string | null;
	ensemble: string;
	element: string | number;
}

export async function parseTorrentFromFilename(
	filename: string,
): Promise<Metafile> {
	return Metafile.decode(await readFile(filename));
}

export async function parseTorrentWithMetadata(
	filename: string,
	torrentInfos: TorrentMetadataInClient[],
): Promise<Metafile> {
	const meta = await parseTorrentFromFilename(filename);
	const client = getClient();
	if (client?.type === Label.QBITTORRENT) {
		const fastResumePath = filename.replace(
			extname(filename),
			".fastresume",
		);
		if (fs.existsSync(fastResumePath)) {
			updateMetafileMetadata(
				meta,
				bencode.decode(await readFile(fastResumePath)),
			);
			return meta;
		} else {
			logger.verbose(
				`No .fastresume found at ${fastResumePath} from ${filename}, using client to get metadata without trackers`,
			);
		}
	}
	// All other clients keep trackers in their .torrent files
	// Also fallback for qBittorrent if .fastresume is missing e.g cross-seed search --torrents ...
	// Getting all trackers for qbit require individual torrent requests but we do have the first active one
	const torrentInfo = torrentInfos.find((t) => t.infoHash === meta.infoHash);
	if (torrentInfo) {
		meta.category = torrentInfo.category;
		meta.tags = torrentInfo.tags;
		if (!meta.trackers.length && torrentInfo.trackers) {
			meta.trackers = torrentInfo.trackers;
		}
	} else if (client) {
		logger.verbose(
			`No torrent info found for ${meta.infoHash} from ${filename}`,
		);
	}
	return meta;
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
	label: SearcheeLabel,
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
			logger.error({
				label,
				message: `Snatch timed out from ${tracker} for ${candidate.name}`,
			});
			logger.debug(`${candidate.name}: ${url}`);
			return resultOfErr(SnatchError.ABORTED);
		} else if (isMagnetRedirectError(e)) {
			logger.verbose({
				label,
				message: `Unsupported: magnet link detected from ${tracker} for ${candidate.name}`,
			});
			logger.debug(`${candidate.name}: ${url}`);
			return resultOfErr(SnatchError.MAGNET_LINK);
		}
		logger.error({
			label,
			message: `Failed to access ${tracker} for ${candidate.name}`,
		});
		logger.debug(`${candidate.name}: ${url}`);
		logger.debug(e);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	}

	if (response.status === 429) {
		return resultOfErr(SnatchError.RATE_LIMITED);
	} else if (!response.ok) {
		logger.error({
			label,
			message: `Error downloading torrent from ${tracker} for ${candidate.name}: ${response.status} ${response.statusText}`,
		});
		const responseText = await response.clone().text();
		logger.debug(
			`${candidate.name}: ${url} - Response: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`,
		);
		return resultOfErr(SnatchError.UNKNOWN_ERROR);
	} else if (response.headers.get("Content-Type") === "application/rss+xml") {
		const responseText = await response.clone().text();
		logger.error({
			label,
			message: `Invalid torrent contents from ${tracker} for ${candidate.name}`,
		});
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
		logger.error({
			label,
			message: `Invalid torrent contents from ${tracker} for ${candidate.name}`,
		});
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

export async function createEnsemblePieces(
	title: string,
	files: File[],
): Promise<{
	key: string;
	element: string | number;
	largestFile: File;
} | null> {
	const episodeKey = getEpisodeKey(stripExtension(title));
	if (!episodeKey) return null;
	const { keyTitle, season, episode } = episodeKey;
	const key = `${keyTitle}${season ? `.${season}` : ""}`;
	const element = episode;
	const largestFile = getLargestFile(files);
	return { key, element, largestFile };
}

async function cacheEnsembleTorrentEntry(
	searchee: SearcheeWithInfoHash,
	torrentSavePaths?: Map<string, string>,
): Promise<EnsembleEntry | null> {
	const ensemblePieces = await createEnsemblePieces(
		searchee.title,
		searchee.files,
	);
	if (!ensemblePieces) return null;
	const { key, element, largestFile } = ensemblePieces;

	let savePath: string | undefined;
	if (searchee.savePath) {
		savePath = searchee.savePath;
	} else if (torrentSavePaths) {
		savePath = torrentSavePaths.get(searchee.infoHash);
	} else {
		const downloadDirResult = await getClient()!.getDownloadDir(searchee, {
			onlyCompleted: false,
		});
		if (downloadDirResult.isErr()) {
			logger.error(
				`Failed to get download dir for ${getLogString(searchee)}`,
			);
			return null;
		}
		savePath = downloadDirResult.unwrap();
	}
	if (!savePath) {
		logger.error(`Failed to get save path for ${getLogString(searchee)}`);
		return null;
	}

	return {
		path: getAbsoluteFilePath(
			getSourceRoot(searchee, savePath),
			largestFile.path,
			searchee.files.length === 1,
		),
		info_hash: searchee.infoHash,
		ensemble: key,
		element,
	};
}

async function indexTorrents(options: { startup: boolean }): Promise<void> {
	const { seasonFromEpisodes, torrentDir, useClientTorrents } =
		getRuntimeConfig();
	if (!useClientTorrents && !torrentDir) return;
	const client = getClient();
	let searchees: SearcheeWithInfoHash[];
	let infoHashPathMap: Map<string, string> | undefined;

	if (options.startup) {
		if (torrentDir) {
			logger.info("Indexing torrentDir for reverse lookup...");
			searchees = await loadTorrentDirLight(torrentDir);
			if (client) {
				infoHashPathMap = await client.getAllDownloadDirs({
					metas: searchees,
					onlyCompleted: false,
					v1HashOnly: true,
				});
			}
		} else {
			logger.info("Indexing client torrents for reverse lookup...");
			searchees = (await client!.getClientSearchees()).searchees;
			infoHashPathMap = searchees.reduce((map, searchee) => {
				map.set(searchee.infoHash, searchee.savePath!);
				return map;
			}, new Map<string, string>());
		}
		if (infoHashPathMap) {
			await validateClientSavePaths(searchees, infoHashPathMap);
		}
	} else {
		if (torrentDir) {
			searchees = await indexTorrentDir(torrentDir);
		} else {
			searchees = (
				await client!.getClientSearchees({
					newSearcheesOnly: true,
				})
			).newSearchees;
		}
	}
	if (!seasonFromEpisodes) return;

	const ensembleRows = (
		await Promise.all(
			searchees.map((searchee) =>
				cacheEnsembleTorrentEntry(searchee, infoHashPathMap),
			),
		)
	).filter(isTruthy);
	await inBatches(ensembleRows, async (batch) => {
		await memDB("ensemble").insert(batch).onConflict("path").merge();
	});
}

async function indexTorrentDir(dir: string): Promise<SearcheeWithInfoHash[]> {
	const dirContents = new Set(await findAllTorrentFilesInDir(dir));

	// Index new torrents in the torrentDir
	let firstNewTorrent = true;
	const newSearchees: SearcheeWithInfoHash[] = [];
	for (const filepath of dirContents) {
		const doesAlreadyExist = await db("torrent")
			.select("id")
			.where({ file_path: filepath })
			.first();

		if (!doesAlreadyExist) {
			if (firstNewTorrent) firstNewTorrent = false;
			let meta: Metafile;
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
			const res = await createSearcheeFromTorrentFile(filepath, []);
			if (res.isOk()) newSearchees.push(res.unwrap());
		}
	}

	const dbFiles = await db("torrent").select({ filePath: "file_path" });
	const dbFilePaths: string[] = dbFiles.map((row) => row.filePath);
	const filesToDelete = dbFilePaths.filter(
		(filePath) => !dirContents.has(filePath),
	);
	await inBatches(filesToDelete, async (batch) => {
		await db("torrent").whereIn("file_path", batch).del();
	});

	return newSearchees;
}

export async function indexTorrentsAndDataDirs(
	options = { startup: false },
): Promise<void> {
	return withMutex(
		Mutex.INDEX_TORRENTS_AND_DATA_DIRS,
		async () => {
			const maxRetries = 3;
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					await Promise.all([
						indexTorrents(options),
						indexDataDirs(options),
					]);
					break;
				} catch (e) {
					const msg = `Indexing failed (${maxRetries - attempt}): ${e.message}`;
					if (attempt < maxRetries) {
						logger.verbose(msg);
					} else {
						logger.error(msg);
						if (options.startup) throw e;
					}
					logger.debug(e);
				}
			}
		},
		{ useQueue: false },
	);
}

export async function getInfoHashesToExclude(): Promise<Set<string>> {
	const { useClientTorrents } = getRuntimeConfig();
	const database = useClientTorrents ? memDB : db;
	return new Set(
		(await database("torrent").select({ infoHash: "info_hash" })).map(
			(e) => e.infoHash,
		),
	);
}

export async function loadTorrentDirLight(
	torrentDir: string,
): Promise<SearcheeWithInfoHash[]> {
	const torrentFilePaths = await findAllTorrentFilesInDir(torrentDir);

	const searchees: SearcheeWithInfoHash[] = [];
	const client = getClient();
	const torrentInfos =
		client && client.type !== Label.QBITTORRENT
			? await client.getAllTorrents()
			: [];
	for (const torrentFilePath of torrentFilePaths) {
		const searcheeResult = await createSearcheeFromTorrentFile(
			torrentFilePath,
			torrentInfos,
		);
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

export async function getSimilarByName(name: string): Promise<{
	keys: string[];
	clientSearchees: SearcheeWithInfoHash[];
	dataSearchees: SearcheeWithoutInfoHash[];
}> {
	const { torrentDir, useClientTorrents } = getRuntimeConfig();
	const { keyTitles, element, useFallback } = getKeysFromName(name);
	const clientSearchees = useFallback
		? await getTorrentByFuzzyName(name)
		: [];
	const dataSearchees = useFallback ? await getDataByFuzzyName(name) : [];
	if (!keyTitles.length) {
		return { keys: [], clientSearchees, dataSearchees };
	}
	const candidateMaxDistance = Math.floor(
		Math.max(...keyTitles.map((keyTitle) => keyTitle.length)) /
			LEVENSHTEIN_DIVISOR,
	);

	const filterEntries = async (
		dbEntries: { title?: string; name?: string }[],
	) => {
		return dbEntries.filter((dbEntry) => {
			const entry = getKeysFromName(dbEntry.title ?? dbEntry.name!);
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
	};

	if (useClientTorrents) {
		clientSearchees.push(
			...(await filterEntries(await memDB("torrent"))).map(
				createSearcheeFromDB,
			),
		);
	} else if (torrentDir) {
		const filteredTorrentEntries = (await filterEntries(
			await db("torrent").select("name", "file_path"),
		)) as { name: string; file_path: string }[];
		if (filteredTorrentEntries.length) {
			const client = getClient();
			const torrentInfos =
				client && client.type !== Label.QBITTORRENT
					? await client.getAllTorrents()
					: [];
			clientSearchees.push(
				...(
					await Promise.all(
						filteredTorrentEntries.map(async (dbTorrent) => {
							return (
								await createSearcheeFromTorrentFile(
									dbTorrent.file_path,
									torrentInfos,
								)
							).orElse(null);
						}),
					)
				).filter(isTruthy),
			);
		}
	}

	const entriesToDelete: string[] = [];
	const filteredDataEntries = (
		(await filterEntries(await memDB("data"))) as {
			title: string;
			path: string;
		}[]
	).filter(({ path }) => {
		if (
			!existsSync(path) ||
			shouldIgnorePathHeuristically(path, statSync(path).isDirectory())
		) {
			entriesToDelete.push(path);
			return false;
		}
		return true;
	});
	await inBatches(entriesToDelete, async (batch) => {
		await memDB("data").whereIn("path", batch).del();
		await memDB("ensemble").whereIn("path", batch).del();
	});
	if (filteredDataEntries.length) {
		dataSearchees.push(
			...(
				await Promise.all(
					filteredDataEntries.map(async (dbData) => {
						return createSearcheeFromPath(dbData.path);
					}),
				)
			)
				.filter(isOk)
				.map((r) => r.unwrap()),
		);
	}
	const keys = element
		? keyTitles.map((keyTitle) => `${keyTitle}.${element}`)
		: keyTitles;
	return { keys, clientSearchees, dataSearchees };
}

async function getTorrentByFuzzyName(
	name: string,
): Promise<SearcheeWithInfoHash[]> {
	const { useClientTorrents } = getRuntimeConfig();

	const database = useClientTorrents
		? await memDB("torrent")
		: await db("torrent");

	// @ts-expect-error fuse types are confused
	const potentialMatches = new Fuse(database, {
		keys: ["title", "name"],
		distance: 6,
		threshold: 0.25,
	}).search(name);
	if (potentialMatches.length === 0) return [];
	if (useClientTorrents) {
		return [createSearcheeFromDB(potentialMatches[0].item)];
	}
	const client = getClient();
	const torrentInfos =
		client && client.type !== Label.QBITTORRENT
			? await client.getAllTorrents()
			: [];
	const res = await createSearcheeFromTorrentFile(
		potentialMatches[0].item.file_path,
		torrentInfos,
	);
	if (res.isOk()) return [res.unwrap()];
	return [];
}

export async function getTorrentByCriteria(
	criteria: TorrentLocator,
): Promise<SearcheeWithInfoHash> {
	const { useClientTorrents } = getRuntimeConfig();
	const database = useClientTorrents ? memDB : db;
	const dbTorrent = await database("torrent")
		.where((b) => b.where({ info_hash: criteria.infoHash }))
		.first();
	if (!dbTorrent) {
		const message = `Torrent client does not have any torrent with criteria ${inspect(
			criteria,
		)}`;
		throw new Error(message);
	}
	if (useClientTorrents) return createSearcheeFromDB(dbTorrent);

	const client = getClient();
	const torrentInfos =
		client && client.type !== Label.QBITTORRENT
			? await client.getAllTorrents()
			: [];
	return (
		await createSearcheeFromTorrentFile(dbTorrent.file_path, torrentInfos)
	).unwrapOrThrow(
		new Error(`Failed to create searchee from ${dbTorrent.file_path}`),
	);
}
