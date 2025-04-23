import { distance } from "fastest-levenshtein";
import bencode from "bencode";
import { readdir, readFile, stat, utimes, writeFile } from "fs/promises";
import Fuse from "fuse.js";
import { extname, join, resolve } from "path";
import { inspect } from "util";
import {
	getClients,
	TorrentMetadataInClient,
	validateClientSavePaths,
} from "./clients/TorrentClient.js";
import {
	LEVENSHTEIN_DIVISOR,
	MediaType,
	SAVED_TORRENTS_INFO_REGEX,
	USER_AGENT,
} from "./constants.js";
import { db } from "./db.js";
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
	getAnimeKeys,
	getEpisodeKeys,
	getLargestFile,
	getMovieKeys,
	getSeasonKeys,
	SearcheeLabel,
	SearcheeWithInfoHash,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import {
	exists,
	filterAsync,
	flatMapAsync,
	getLogString,
	inBatches,
	mapAsync,
	Mutex,
	notExists,
	stripExtension,
	wait,
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
	client_host: string | null;
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
	const clients = getClients();
	if (clients[0]?.clientType === Label.QBITTORRENT) {
		const fastResumePath = filename.replace(
			extname(filename),
			".fastresume",
		);
		if (await exists(fastResumePath)) {
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
	} else if (clients.length) {
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

async function snatchOnce(
	candidate: Candidate,
): Promise<
	| Metafile
	| { snatchError: SnatchError; retryAfterMs?: number; extra?: string }
> {
	const { snatchTimeout } = getRuntimeConfig();
	const url = candidate.link;

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
			logger.debug(`${candidate.name}: ${url}`);
			return {
				snatchError: SnatchError.ABORTED,
				extra: `snatch timed out`,
			};
		} else if (isMagnetRedirectError(e)) {
			logger.debug(`${candidate.name}: ${url}`);
			return { snatchError: SnatchError.MAGNET_LINK };
		}
		logger.debug(`${candidate.name}: ${url}`);
		logger.debug(e);
		return {
			snatchError: SnatchError.UNKNOWN_ERROR,
			extra: `failed to access`,
		};
	}

	const retryAfterSeconds = Number(response.headers.get("Retry-After"));
	const retryAfterMs = !Number.isNaN(retryAfterSeconds)
		? retryAfterSeconds * 1000
		: undefined;
	if (response.status === 429) {
		return { snatchError: SnatchError.RATE_LIMITED, retryAfterMs };
	} else if (!response.ok) {
		const responseText = await response.clone().text();
		logger.debug(
			`${candidate.name}: ${url} - Response: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`,
		);
		return {
			snatchError: SnatchError.UNKNOWN_ERROR,
			retryAfterMs,
			extra: `error downloading torrent - ${response.status} ${response.statusText}`,
		};
	} else if (response.headers.get("Content-Type") === "application/rss+xml") {
		const responseText = await response.clone().text();
		logger.debug(
			`${candidate.name}: ${url} - Contents: "${responseText.slice(0, 100)}${
				responseText.length > 100 ? "..." : ""
			}"`,
		);
		return { snatchError: SnatchError.INVALID_CONTENTS, retryAfterMs };
	}
	try {
		return Metafile.decode(
			Buffer.from(new Uint8Array(await response.arrayBuffer())),
		);
	} catch (e) {
		const contentType = response.headers.get("Content-Type");
		const contentLength = response.headers.get("Content-Length");
		logger.debug(
			`${candidate.name}: ${url} - Content-Type: ${contentType} - Content-Length: ${contentLength}`,
		);
		logger.debug(e);
		return { snatchError: SnatchError.INVALID_CONTENTS, retryAfterMs };
	}
}

export async function snatch(
	candidate: Candidate,
	label: SearcheeLabel,
	options: { retries: number; delayMs: number },
): Promise<Result<Metafile, SnatchError>> {
	const retries = Math.max(options.retries, 0);
	const retryAfterEndTime = Date.now() + retries * options.delayMs;

	let snatchError: SnatchError;
	for (let i = 0; i <= retries; i++) {
		const snatchResult = await snatchOnce(candidate);
		if (snatchResult instanceof Metafile) return resultOf(snatchResult);
		snatchError = snatchResult.snatchError;
		if (
			snatchError === SnatchError.RATE_LIMITED ||
			snatchError === SnatchError.MAGNET_LINK
		) {
			return resultOfErr(snatchError);
		}
		const { extra, retryAfterMs } = snatchResult;
		const progress = `${i + 1}/${retries + 1}`;
		if (retryAfterMs && Date.now() + retryAfterMs >= retryAfterEndTime) {
			logger.warn({
				label,
				message: `Snatching ${candidate.name} from ${candidate.tracker} stopped at attempt ${progress}, Retry-After of ${retryAfterMs / 1000}s exceeds timeout: ${snatchError}${extra ? ` - ${extra}` : ""}`,
			});
			return resultOfErr(snatchError);
		}
		const delayMs = Math.max(options.delayMs, retryAfterMs ?? 0);
		logger.error({
			label,
			message: `Snatch attempt ${progress} from ${candidate.tracker} for ${candidate.name} failed${i < retries ? `, retrying in ${delayMs / 1000}s` : ""}: ${snatchError}${extra ? ` - ${extra}` : ""}`,
		});
		if (i >= retries) break;
		await wait(delayMs);
	}
	return resultOfErr(snatchError!);
}

export async function saveTorrentFile(
	tracker: string,
	tag: string,
	meta: Metafile,
): Promise<void> {
	const { outputDir } = getRuntimeConfig();
	// Be sure to update parseInfoFromSavedTorrent if changing the format
	const filePath = join(
		outputDir,
		`[${tag}][${tracker}]${stripExtension(
			meta.getFileSystemSafeName(),
		)}[${meta.infoHash}].torrent`,
	);
	if (await exists(filePath)) {
		await utimes(filePath, new Date(), (await stat(filePath)).mtime);
		return;
	}
	await writeFile(filePath, new Uint8Array(meta.encode()));
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

export function createEnsemblePieces(
	title: string,
	files: File[],
): { key: string; element: string | number; largestFile: File }[] | null {
	const episodeKeys = getEpisodeKeys(stripExtension(title));
	if (!episodeKeys) return null;
	const element = episodeKeys.episode;
	const largestFile = getLargestFile(files);
	return episodeKeys.keyTitles.map((keyTitle) => {
		const key = `${keyTitle}${episodeKeys.season ? `.${episodeKeys.season}` : ""}`;
		return { key, element, largestFile };
	});
}

export async function cacheEnsembleTorrentEntry(
	searchee: SearcheeWithInfoHash,
	torrentSavePaths?: Map<string, string>,
): Promise<EnsembleEntry[] | null> {
	const ensemblePieces = createEnsemblePieces(searchee.title, searchee.files);
	if (!ensemblePieces || !ensemblePieces.length) return null;

	let savePath: string | undefined;
	if (searchee.savePath) {
		savePath = searchee.savePath;
	} else if (torrentSavePaths) {
		savePath = torrentSavePaths.get(searchee.infoHash);
	} else {
		const downloadDirResult = await getClients()[0].getDownloadDir(
			searchee,
			{
				onlyCompleted: false,
			},
		);
		if (downloadDirResult.isErr()) {
			logger.error(
				`Failed to get download dir for ${getLogString(searchee)}: ${downloadDirResult.unwrapErr()}`,
			);
			return null;
		}
		savePath = downloadDirResult.unwrap();
	}
	if (!savePath) {
		logger.error(`Failed to get save path for ${getLogString(searchee)}`);
		return null;
	}

	return ensemblePieces.map((ensemblePiece) => ({
		client_host: searchee.clientHost ?? null,
		path: join(savePath, ensemblePiece.largestFile.path),
		info_hash: searchee.infoHash,
		ensemble: ensemblePiece.key,
		element: ensemblePiece.element,
	}));
}

async function indexTorrents(options: { startup: boolean }): Promise<void> {
	const { seasonFromEpisodes, torrentDir, useClientTorrents } =
		getRuntimeConfig();
	if (!useClientTorrents && !torrentDir) return;
	const clients = getClients();
	let searchees: SearcheeWithInfoHash[];
	let infoHashPathMap: Map<string, string> | undefined;

	if (options.startup) {
		if (torrentDir) {
			logger.info("Indexing torrentDir for reverse lookup...");
			searchees = await loadTorrentDirLight(torrentDir);
			if (clients.length) {
				infoHashPathMap = await clients[0].getAllDownloadDirs({
					metas: searchees,
					onlyCompleted: false,
					v1HashOnly: true,
				});
				await validateClientSavePaths(
					searchees,
					infoHashPathMap,
					clients[0].label,
					clients[0].clientPriority,
				);
			}
		} else {
			logger.info("Indexing client torrents for reverse lookup...");
			searchees = await flatMapAsync(clients, async (client) => {
				const { searchees } = await client.getClientSearchees();
				await validateClientSavePaths(
					searchees,
					searchees.reduce((map, searchee) => {
						map.set(searchee.infoHash, searchee.savePath);
						return map;
					}, new Map<string, string>()),
					client.label,
					client.clientPriority,
				);
				return searchees;
			});
		}
	} else {
		if (torrentDir) {
			searchees = await indexTorrentDir(torrentDir);
		} else {
			searchees = await flatMapAsync(
				clients,
				async (client) =>
					(
						await client.getClientSearchees({
							newSearcheesOnly: true,
						})
					).newSearchees,
			);
		}
	}
	if (!seasonFromEpisodes) return;

	const ensembleRows = await flatMapAsync(
		searchees,
		async (searchee) =>
			(await cacheEnsembleTorrentEntry(searchee, infoHashPathMap)) ?? [],
	);
	await inBatches(ensembleRows, async (batch) => {
		await db("ensemble")
			.insert(batch)
			.onConflict(["client_host", "path"])
			.merge();
	});
}

async function indexTorrentDir(dir: string): Promise<SearcheeWithInfoHash[]> {
	const dirContents = new Set(await findAllTorrentFilesInDir(dir));

	const newSearchees: SearcheeWithInfoHash[] = [];
	for (const filepath of dirContents) {
		const doesAlreadyExist = await db("torrent")
			.select("id")
			.where({ file_path: filepath })
			.first();
		if (doesAlreadyExist) continue;

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

	const rows = await db("torrent").select("file_path", "info_hash");
	const toDelete = rows.filter((row) => !dirContents.has(row.file_path));
	await inBatches(toDelete, async (batch) => {
		await db("torrent")
			.whereIn(
				"file_path",
				batch.map((row) => row.file_path),
			)
			.del();
		await db("ensemble")
			.whereIn(
				"info_hash",
				batch.map((row) => row.info_hash),
			)
			.del();
	});

	return newSearchees;
}

export async function indexTorrentsAndDataDirs(
	options = { startup: false },
): Promise<void> {
	if (options.startup) {
		const { dataDirs, seasonFromEpisodes, torrentDir, useClientTorrents } =
			getRuntimeConfig();
		if (!useClientTorrents) {
			const hashes = await db("client_searchee").select("info_hash");
			await inBatches(hashes, async (batch) => {
				await db("ensemble")
					.whereIn(
						"info_hash",
						batch.map((row) => row.info_hash),
					)
					.del();
			});
			await db("client_searchee").del();
		}
		if (!torrentDir) {
			const hashes = await db("torrent").select("info_hash");
			await inBatches(hashes, async (batch) => {
				await db("ensemble")
					.whereIn(
						"info_hash",
						batch.map((row) => row.info_hash),
					)
					.del();
			});
			await db("torrent").del();
		}
		if (!dataDirs.length) {
			const paths = await db("data").select("path");
			await inBatches(paths, async (batch) => {
				await db("ensemble")
					.whereIn(
						"path",
						batch.map((row) => row.path),
					)
					.del();
			});
			await db("data").del();
		}
		if (!seasonFromEpisodes) await db("ensemble").del();
	}
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
					logger.debug(e);
					if (attempt < maxRetries) {
						logger.verbose(msg);
					} else {
						logger.error(msg);
						if (options.startup) throw e;
					}
				}
			}
		},
		{ useQueue: false },
	);
}

export async function getInfoHashesToExclude(): Promise<Set<string>> {
	const { useClientTorrents } = getRuntimeConfig();
	const database = useClientTorrents ? db("client_searchee") : db("torrent");
	return new Set(
		(await database.select({ infoHash: "info_hash" })).map(
			(e) => e.infoHash,
		),
	);
}

export async function loadTorrentDirLight(
	torrentDir: string,
): Promise<SearcheeWithInfoHash[]> {
	const torrentFilePaths = await findAllTorrentFilesInDir(torrentDir);

	const searchees: SearcheeWithInfoHash[] = [];
	const client = getClients()[0];
	const torrentInfos =
		client && client.clientType !== Label.QBITTORRENT
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
	const episodeKeys = getEpisodeKeys(stem);
	if (episodeKeys) {
		const keyTitles = episodeKeys.keyTitles;
		const element = `${episodeKeys.season ? `${episodeKeys.season}.` : ""}${episodeKeys.episode}`;
		return { keyTitles, element, useFallback: false };
	}
	const seasonKeys = getSeasonKeys(stem);
	if (seasonKeys) {
		const keyTitles = seasonKeys.keyTitles;
		const element = seasonKeys.season;
		return { keyTitles, element, useFallback: false };
	}
	const movieKeys = getMovieKeys(stem);
	if (movieKeys) {
		const keyTitles = movieKeys.keyTitles;
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
		keyTitles.reduce((sum, title) => sum + title.length, 0) /
			keyTitles.length /
			LEVENSHTEIN_DIVISOR,
	);

	const filterEntries = (dbEntries: { title?: string; name?: string }[]) => {
		return dbEntries.filter((dbEntry) => {
			const entry = getKeysFromName(dbEntry.title ?? dbEntry.name!);
			if (entry.element !== element) return false;
			if (!entry.keyTitles.length) return false;
			const maxDistance = Math.max(
				candidateMaxDistance,
				Math.floor(
					entry.keyTitles.reduce(
						(sum, title) => sum + title.length,
						0,
					) /
						entry.keyTitles.length /
						LEVENSHTEIN_DIVISOR,
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
			...filterEntries(await db("client_searchee")).map(
				createSearcheeFromDB,
			),
		);
	} else if (torrentDir) {
		const filteredTorrentEntries = filterEntries(
			await db("torrent").select("name", "file_path"),
		) as { name: string; file_path: string }[];
		if (filteredTorrentEntries.length) {
			const client = getClients()[0];
			const torrentInfos =
				client && client.clientType !== Label.QBITTORRENT
					? await client.getAllTorrents()
					: [];
			clientSearchees.push(
				...(
					await mapAsync(filteredTorrentEntries, (dbTorrent) =>
						createSearcheeFromTorrentFile(
							dbTorrent.file_path,
							torrentInfos,
						),
					)
				)
					.filter(isOk)
					.map((r) => r.unwrap()),
			);
		}
	}

	const entriesToDelete: string[] = [];
	const filteredDataEntries = await filterAsync(
		filterEntries(await db("data")) as {
			title: string;
			path: string;
		}[],
		async ({ path }) => {
			if (
				(await notExists(path)) ||
				shouldIgnorePathHeuristically(
					path,
					(await stat(path)).isDirectory(),
				)
			) {
				entriesToDelete.push(path);
				return false;
			}
			return true;
		},
	);
	await inBatches(entriesToDelete, async (batch) => {
		await db("data").whereIn("path", batch).del();
		await db("ensemble").whereIn("path", batch).del();
	});
	if (filteredDataEntries.length) {
		dataSearchees.push(
			...(
				await mapAsync(filteredDataEntries, (dbData) =>
					createSearcheeFromPath(dbData.path),
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
		? await db("client_searchee")
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
	const client = getClients()[0];
	const torrentInfos =
		client && client.clientType !== Label.QBITTORRENT
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
): Promise<SearcheeWithInfoHash[]> {
	const { useClientTorrents } = getRuntimeConfig();
	const database = useClientTorrents ? db("client_searchee") : db("torrent");
	const dbTorrents = await database.where((b) =>
		b.where({ info_hash: criteria.infoHash }),
	);
	if (!dbTorrents.length) {
		const message = `Torrent client does not have any torrent with criteria ${inspect(
			criteria,
		)}`;
		throw new Error(message);
	}
	if (useClientTorrents) return dbTorrents.map(createSearcheeFromDB);

	const client = getClients()[0];
	const torrentInfos =
		client && client.clientType !== Label.QBITTORRENT
			? await client.getAllTorrents()
			: [];
	return [
		(
			await createSearcheeFromTorrentFile(
				dbTorrents[0].file_path,
				torrentInfos,
			)
		).unwrapOrThrow(
			new Error(
				`Failed to create searchee from ${dbTorrents[0].file_path}`,
			),
		),
	];
}
