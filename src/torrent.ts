import { distance } from "fastest-levenshtein";
import bencode from "bencode";
import { readdir, readFile, stat } from "fs/promises";
import { extname, join, resolve } from "path";
import { inspect } from "util";
import {
	getClients,
	TorrentMetadataInClient,
	validateClientSavePaths,
} from "./clients/TorrentClient.js";
import { isChildPath } from "./utils.js";
import {
	LEVENSHTEIN_DIVISOR,
	MAX_PATH_BYTES,
	MediaType,
	SAVED_TORRENTS_INFO_REGEX,
	USER_AGENT,
} from "./constants.js";
import {
	getDataByFuzzyName,
	indexDataDirs,
	shouldIgnorePathHeuristically,
} from "./dataFiles.js";
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
	createKeyTitle,
	exists,
	filterAsync,
	filterAsyncYield,
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

export interface TorrentLocator {
	infoHash?: string;
	path?: string;
}

export interface FilenameMetadata {
	mediaType: string;
	tracker: string;
	name: string;
	infoHash?: string;
	cached: boolean;
}

export enum SnatchError {
	ABORTED = "ABORTED",
	RATE_LIMITED = "RATE_LIMITED",
	MAGNET_LINK = "MAGNET_LINK",
	INVALID_CONTENTS = "INVALID_CONTENTS",
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

interface TorrentEntry {
	title?: string;
	name?: string;
	file_path?: string;
}

export interface EnsembleEntry {
	client_host: string | null;
	path: string;
	info_hash: string | null;
	ensemble: string;
	element: string | number;
}

export async function parseTorrentFromPath(
	filePath: string,
): Promise<Metafile> {
	return Metafile.decode(await readFile(filePath));
}

export async function parseTorrentWithMetadata(
	filePath: string,
	torrentInfos: TorrentMetadataInClient[],
): Promise<Metafile> {
	const meta = await parseTorrentFromPath(filePath);
	const clients = getClients();
	if (clients[0]?.clientType === Label.QBITTORRENT) {
		const fastResumePath = filePath.replace(
			extname(filePath),
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
				`No .fastresume found at ${fastResumePath} from ${filePath}, using client to get metadata without trackers`,
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
			`No torrent info found for ${meta.infoHash} from ${filePath}`,
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
			headers: {
				...(candidate.cookie ? { Cookie: candidate.cookie } : {}),
				"User-Agent": USER_AGENT,
			},
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

export const snatchHistory = new Map<
	string,
	{ initialFailureAt: number; numFailures: number }
>();

export async function snatch(
	candidate: Candidate,
	label: SearcheeLabel,
	options: { retries: number; delayMs: number },
): Promise<Result<Metafile, SnatchError>> {
	const retries = Math.max(options.retries, 0);
	const retryAfterEndTime = Date.now() + retries * options.delayMs;

	let snatchError: SnatchError;
	for (let i = 0; i <= retries; i++) {
		const progress = `${i + 1}/${retries + 1}`;
		const snatchResult = await snatchOnce(candidate);
		if (snatchResult instanceof Metafile) {
			logger.verbose({
				label,
				message: `Snatched ${candidate.name} from ${candidate.tracker}${i > 0 ? ` on attempt ${progress}` : ""}`,
			});
			snatchHistory.delete(candidate.link);
			return resultOf(snatchResult);
		}
		snatchError = snatchResult.snatchError;
		if (
			snatchError === SnatchError.RATE_LIMITED ||
			snatchError === SnatchError.MAGNET_LINK
		) {
			snatchHistory.delete(candidate.link);
			return resultOfErr(snatchError);
		}
		const { extra, retryAfterMs } = snatchResult;
		let linkHistory = snatchHistory.get(candidate.link);
		if (linkHistory) {
			++linkHistory.numFailures;
		} else {
			linkHistory = { initialFailureAt: Date.now(), numFailures: 1 };
			snatchHistory.set(candidate.link, linkHistory);
		}
		let trackerHistory = snatchHistory.get(candidate.tracker);
		if (trackerHistory) {
			++trackerHistory.numFailures;
		} else {
			trackerHistory = { initialFailureAt: Date.now(), numFailures: 1 };
			snatchHistory.set(candidate.tracker, trackerHistory);
		}
		if (linkHistory.numFailures > retries + 1) {
			logger.warn({
				label,
				message: `Snatching ${candidate.name} from ${candidate.tracker} stopped after attempt ${progress}, this snatch has failed too many times recently: ${snatchError}${extra ? ` - ${extra}` : ""}`,
			});
			return resultOfErr(snatchError);
		}
		if (trackerHistory.numFailures > retries * 2 + 1) {
			logger.warn({
				label,
				message: `Snatching ${candidate.name} from ${candidate.tracker} stopped after attempt ${progress}, this tracker has failed too many times recently: ${snatchError}${extra ? ` - ${extra}` : ""}`,
			});
			return resultOfErr(snatchError);
		}
		if (retryAfterMs && Date.now() + retryAfterMs >= retryAfterEndTime) {
			logger.warn({
				label,
				message: `Snatching ${candidate.name} from ${candidate.tracker} stopped after attempt ${progress}, Retry-After of ${retryAfterMs / 1000}s exceeds timeout: ${snatchError}${extra ? ` - ${extra}` : ""}`,
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

function buildTorrentSaveName(
	mediaType: MediaType,
	tracker: string,
	name: string,
	infoHash: string,
	ext: string,
): string {
	return `[${mediaType}][${tracker}]${name}[${infoHash}]${ext}`;
}

/**
 * Be sure to update parseMetadataFromFilename if changing the format
 */
export function getTorrentSavePath(
	meta: Metafile,
	mediaType: MediaType,
	tracker: string,
	dir: string,
	options: { cached: boolean },
): string {
	const fullName = stripExtension(meta.getFileSystemSafeName());
	const ext = options.cached ? ".cached.torrent" : ".torrent";
	const fullPath = join(
		dir,
		buildTorrentSaveName(mediaType, tracker, fullName, meta.infoHash, ext),
	);
	if (Buffer.byteLength(fullPath, "utf8") <= MAX_PATH_BYTES) return fullPath;

	const codePoints = Array.from(fullName);
	let currBytes = Buffer.byteLength(`${fullPath}...`, "utf8");
	let codePointsToRemove = 0;
	for (let i = codePoints.length - 1; i >= 0; i--) {
		codePointsToRemove++;
		currBytes -= Buffer.byteLength(codePoints[i], "utf8");
		if (currBytes <= MAX_PATH_BYTES) break;
	}
	const safeName = `${codePoints.slice(0, -codePointsToRemove).join("")}...`;
	const safePath = join(
		dir,
		buildTorrentSaveName(mediaType, tracker, safeName, meta.infoHash, ext),
	);
	return safePath; // Handle the error on save if it exists
}

/**
 * Depends on getTorrentSavePath format
 */
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
	const { tracker, name, infoHash, cached } = match.groups!;
	return { mediaType, tracker, name, infoHash, cached: !!cached };
}

export async function findAllTorrentFilesInDir(dir: string): Promise<string[]> {
	return (await readdir(dir))
		.filter((fn) => extname(fn) === ".torrent")
		.sort()
		.map((fn) => resolve(join(dir, fn)));
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
			logger.info({
				label: Label.INDEX,
				message: "Indexing torrentDir for reverse lookup...",
			});
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
				const { searchees } = await client.getClientSearchees({
					includeFiles: true,
					includeTrackers: true,
				});
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
							includeFiles: true,
							includeTrackers: true,
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
	for (const filePath of dirContents) {
		const doesAlreadyExist = await db("torrent")
			.select("id")
			.where({ file_path: filePath })
			.first();
		if (doesAlreadyExist) continue;

		let meta: Metafile;
		try {
			meta = await parseTorrentFromPath(filePath);
		} catch (e) {
			logOnce(`Failed to parse ${filePath}`, () => {
				logger.error({
					label: Label.INDEX,
					message: `Failed to parse ${filePath}`,
				});
				logger.debug(e);
			});
			continue;
		}
		await db("torrent")
			.insert({
				file_path: filePath,
				info_hash: meta.infoHash,
				name: meta.name,
			})
			.onConflict("file_path")
			.ignore();
		const res = await createSearcheeFromTorrentFile(filePath, []);
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
			const hashes = (
				await db("client_searchee").select("info_hash")
			).map((r) => r.info_hash);
			await inBatches(hashes, async (batch) => {
				await db("ensemble").whereIn("info_hash", batch).del();
			});
			await db("client_searchee").del();
		} else {
			const clientHosts = getClients().map((client) => client.clientHost);
			await db("client_searchee")
				.whereNotIn("client_host", clientHosts)
				.del();
			await db("ensemble")
				.whereNotNull("client_host")
				.whereNotIn("client_host", clientHosts)
				.del();
		}
		if (!torrentDir) {
			const hashes = (await db("torrent").select("info_hash")).map(
				(r) => r.info_hash,
			);
			await inBatches(hashes, async (batch) => {
				await db("ensemble").whereIn("info_hash", batch).del();
			});
			await db("torrent").del();
		}
		if (!dataDirs.length) {
			const paths = (await db("data").select("path")).map((r) => r.path);
			await inBatches(paths, async (batch) => {
				await db("ensemble")
					.whereIn("path", batch)
					.whereNull("client_host")
					.del();
			});
			await db("data").del();
		} else {
			const paths = (await db("data").select("path")).map((r) => r.path);
			const toDelete = paths.filter((p) => !isChildPath(p, dataDirs));
			await inBatches(toDelete, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble")
					.whereIn("path", batch)
					.whereNull("client_host")
					.del();
			});
		}
		if (!seasonFromEpisodes) await db("ensemble").del();
	}
	return withMutex(
		Mutex.INDEX_TORRENTS_AND_DATA_DIRS,
		{ useQueue: false },
		async () => {
			const maxRetries = 3;
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					await indexDataDirs(options); // Running together may increase failures
					await indexTorrents(options); // Run second so this data is more fresh
					break;
				} catch (e) {
					const log = {
						label: Label.INDEX,
						message: `Indexing failed (${maxRetries - attempt}): ${e.message}`,
					};
					logger.debug(e);
					if (attempt < maxRetries) {
						logger.verbose(log);
					} else {
						logger.error(log);
						if (options.startup) throw e;
					}
				}
			}
		},
	);
}

export async function getInfoHashesToExclude(): Promise<Set<string>> {
	const { useClientTorrents } = getRuntimeConfig();
	const database = useClientTorrents ? db("client_searchee") : db("torrent");
	return new Set((await database.select("*")).map((e) => e.info_hash));
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
		return { keyTitles, element, useFallback: false };
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
		Math.min(...keyTitles.map((t) => t.length)) / LEVENSHTEIN_DIVISOR,
	);

	const filterEntries = async (dbEntries: TorrentEntry[]) => {
		return filterAsyncYield(dbEntries, async (dbEntry) => {
			const entry = getKeysFromName(dbEntry.title ?? dbEntry.name!);
			if (entry.element !== element) return false;
			if (!entry.keyTitles.length) return false;
			const maxDistance = Math.min(
				candidateMaxDistance,
				Math.floor(
					Math.min(...entry.keyTitles.map((t) => t.length)) /
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
			...(await filterEntries(await db("client_searchee"))).map(
				createSearcheeFromDB,
			),
		);
	} else if (torrentDir) {
		const filteredTorrentEntries = (await filterEntries(
			await db("torrent").select("name", "file_path"),
		)) as { name: string; file_path: string }[];
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
		(await filterEntries(await db("data"))) as {
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

	const database: TorrentEntry[] = useClientTorrents
		? await db("client_searchee")
		: await db("torrent");
	const fullMatch = createKeyTitle(name);

	// Attempt to filter torrents in DB to match incoming data before fuzzy check
	let filteredNames: TorrentEntry[] = [];
	if (fullMatch) {
		filteredNames = await filterAsyncYield(database, async (dbEntry) => {
			const dbMatch = createKeyTitle(dbEntry.title ?? dbEntry.name!);
			return fullMatch === dbMatch;
		});
	}

	// If none match, proceed with fuzzy name check on all names.
	filteredNames = filteredNames.length > 0 ? filteredNames : database;

	const candidateMaxDistance = Math.floor(name.length / LEVENSHTEIN_DIVISOR);
	const potentialMatches = await filterAsyncYield(
		filteredNames,
		async (dbEntry) => {
			const dbTitle = dbEntry.title ?? dbEntry.name!;
			const maxDistance = Math.min(
				candidateMaxDistance,
				Math.floor(dbTitle.length / LEVENSHTEIN_DIVISOR),
			);
			return distance(name, dbTitle) <= maxDistance;
		},
	);

	if (useClientTorrents) return potentialMatches.map(createSearcheeFromDB);
	const client = getClients()[0];
	const torrentInfos =
		client && client.clientType !== Label.QBITTORRENT
			? await client.getAllTorrents()
			: [];
	return (
		await mapAsync(potentialMatches, (dbTorrent) =>
			createSearcheeFromTorrentFile(dbTorrent.file_path!, torrentInfos),
		)
	)
		.filter(isOk)
		.map((r) => r.unwrap());
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
