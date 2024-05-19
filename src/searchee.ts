import ms from "ms";
import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { getClient } from "./clients/TorrentClient.js";
import {
	ANIME_REGEX,
	EP_REGEX,
	RELEASE_GROUP_REGEX,
	SEASON_REGEX,
	RES_STRICT_REGEX,
	SOURCE_REGEX,
	IGNORED_FOLDERS_REGEX,
	SearchSource,
} from "./constants.js";
import { logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { parseTorrentFromFilename } from "./torrent.js";
import {
	getLargestFile,
	humanReadableSize,
	reformatTitleForSearching,
	stripExtension,
	WithRequired,
} from "./utils.js";

export interface File {
	length: number;
	name: string;
	path: string;
}

export interface Searchee {
	// if searchee is torrent based
	infoHash?: string;
	// if searchee is data based
	path?: string;
	files: File[];
	name: string;
	length: number;
	source?: SearchSource;
}

export type SearcheeWithInfoHash = WithRequired<Searchee, "infoHash">;

export function hasInfoHash(
	searchee: Searchee,
): searchee is SearcheeWithInfoHash {
	return searchee.infoHash != null;
}

function getFileNamesFromRootRec(root: string, isDirHint?: boolean): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
	if (isDir) {
		return readdirSync(root, { withFileTypes: true }).flatMap((dirent) =>
			getFileNamesFromRootRec(
				join(root, dirent.name),
				dirent.isDirectory(),
			),
		);
	} else {
		return [root];
	}
}

function getFilesFromDataRoot(rootPath: string): File[] {
	const parentDir = join(rootPath, "..");
	return getFileNamesFromRootRec(rootPath).map((file) => ({
		path: relative(parentDir, file),
		name: basename(file),
		length: statSync(file).size,
	}));
}

export function createSearcheeFromMetafile(
	meta: Metafile,
	source?: SearchSource,
): Searchee {
	return {
		files: meta.files,
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
		source: source,
	};
}

export async function createSearcheeFromTorrentFile(
	filepath: string,
	source?: SearchSource,
): Promise<Result<Searchee, Error>> {
	try {
		const meta = await parseTorrentFromFilename(filepath);
		return resultOf(createSearcheeFromMetafile(meta, source));
	} catch (e) {
		logger.error(`Failed to parse ${basename(filepath)}`);
		logger.debug(e);
		return resultOfErr(e);
	}
}

export async function createSearcheeFromPath(
	filepath: string,
	source?: SearchSource,
): Promise<Result<Searchee, Error>> {
	const files = getFilesFromDataRoot(filepath);
	if (files.length === 0) {
		return resultOfErr(new Error("No files found"));
	}
	const totalLength = files.reduce<number>(
		(runningTotal, file) => runningTotal + file.length,
		0,
	);
	const seasonMatch =
		basename(filepath).length < 12
			? basename(filepath).match(IGNORED_FOLDERS_REGEX)
			: undefined;

	return resultOf({
		files: files,
		path: filepath,
		name: seasonMatch
			? `${basename(dirname(filepath))} S${seasonMatch?.groups?.season}`
			: basename(filepath),
		length: totalLength,
		source: source,
	});
}

export async function getSeasonKey(name: string): Promise<string | null> {
	const stem = stripExtension(name);
	const match = stem.match(SEASON_REGEX);
	if (!match) return null;
	const title = match.groups!.title;
	const season = match.groups!.season;
	const resolution = stem.match(RES_STRICT_REGEX)?.groups?.res;
	const source = stem.match(SOURCE_REGEX)?.groups?.source;
	const group = stem.match(RELEASE_GROUP_REGEX)?.groups?.group;
	return `${reformatTitleForSearching(title)}.${season}.${resolution ? resolution : ""}.${source ? source : ""}-${group ? group : ""}`.toLowerCase();
}

export async function getEpisodeAndKeys(
	name: string,
): Promise<string[] | null> {
	const stem = stripExtension(name);
	const episodeMatch = stem.match(EP_REGEX);
	if (!episodeMatch) return null;
	const episode = episodeMatch!.groups!.episode;
	if (!episode) return null; // Date based shows
	const title = episodeMatch!.groups!.title;
	const season = episodeMatch!.groups!.season;
	const resolution = stem.match(RES_STRICT_REGEX)?.groups?.res;
	const source = stem.match(SOURCE_REGEX)?.groups?.source;
	const group = stem.match(RELEASE_GROUP_REGEX)?.groups?.group;
	const key =
		`${reformatTitleForSearching(title)}.${season}.${resolution ? resolution : ""}.${source ? source : ""}-${group ? group : ""}`.toLowerCase();
	return [episode, key];
}

export async function getReleaseAndKeys(
	name: string,
): Promise<string[] | null> {
	const stem = stripExtension(name);
	const animeMatch = stem.match(ANIME_REGEX);
	if (!animeMatch) return null;
	const firstTitle = animeMatch!.groups!.title;
	const altTitle = animeMatch!.groups!.altTitle;
	const release = animeMatch!.groups!.release;
	const resolution = stem.match(RES_STRICT_REGEX)?.groups?.res;
	const source = stem.match(SOURCE_REGEX)?.groups?.source;
	let group = stem.match(RELEASE_GROUP_REGEX)?.groups?.group;
	group = group ? group : animeMatch!.groups!.group;
	const keys: string[] = [];
	for (const title of [firstTitle, altTitle]) {
		if (!title) continue;
		if (title.toLowerCase() === "season") continue;
		if (title.toLowerCase() === "ep") continue;
		const key =
			`${reformatTitleForSearching(title)}.${resolution ? resolution : ""}.${source ? source : ""}-${group ? group : ""}`.toLowerCase();
		keys.push(key);
	}
	if (keys.length === 0) return null;
	return [release, ...keys];
}

export async function createEnsembleSearchees(
	allSearchees: Searchee[],
	useFilters: boolean,
): Promise<Searchee[]> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	if (!seasonFromEpisodes) return [];

	function logReason(reason): void {
		if (!useFilters) return;
		logger.verbose(reason);
	}

	logReason(`Creating virtual searchees for seasons...`);
	const seasonsMap = new Map<string, Searchee[]>();
	if (useFilters) {
		for (const searchee of allSearchees) {
			const key = await getSeasonKey(searchee.name);
			if (key) {
				if (seasonsMap.has(key)) {
					seasonsMap.get(key)!.push(searchee);
				} else {
					seasonsMap.set(key, [searchee]);
				}
			}
		}
	}
	const episodesMap = new Map<string, Map<string, Searchee[]>>();
	for (const searchee of allSearchees) {
		const episodeAndKeys = await getEpisodeAndKeys(searchee.name);
		if (episodeAndKeys) {
			const [episode, ...keys] = episodeAndKeys;
			for (const key of keys) {
				if (seasonsMap.has(key)) continue;
				if (episodesMap.has(key)) {
					if (episodesMap.get(key)!.has(episode)) {
						const currFile = getLargestFile(searchee);
						const isUniqueFile = episodesMap
							.get(key)!
							.get(episode)!
							.every((e) => {
								return (
									currFile.length !== getLargestFile(e).length
								);
							});
						if (isUniqueFile) {
							episodesMap.get(key)!.get(episode)!.push(searchee);
						}
					} else {
						episodesMap.get(key)!.set(episode, [searchee]);
					}
				} else {
					episodesMap.set(key, new Map([[episode, [searchee]]]));
				}
			}
			if (useFilters) continue;
		}
		if (useFilters && SEASON_REGEX.test(searchee.name)) continue;
		const releaseAndKeys = await getReleaseAndKeys(searchee.name);
		if (releaseAndKeys) {
			const [episode, ...keys] = releaseAndKeys;
			for (const key of keys) {
				if (episodesMap.has(key)) {
					if (episodesMap.get(key)!.has(episode)) {
						const currFile = getLargestFile(searchee);
						const isUniqueFile = episodesMap
							.get(key)!
							.get(episode)!
							.every((e) => {
								return (
									currFile.length !== getLargestFile(e).length
								);
							});
						if (isUniqueFile) {
							episodesMap.get(key)!.get(episode)!.push(searchee);
						}
					} else {
						episodesMap.get(key)!.set(episode, [searchee]);
					}
				} else {
					episodesMap.set(key, new Map([[episode, [searchee]]]));
				}
			}
			if (useFilters) continue;
		}
	}

	const torrentSavePaths = await getClient().getAllDownloadDirs(
		false,
		allSearchees.filter(hasInfoHash),
	);

	const seasonSearchees: Searchee[] = [];
	for (const [key, episodeSearchees] of episodesMap) {
		if (useFilters && episodeSearchees.size < 3) {
			continue;
		}
		const episodes = Array.from(episodeSearchees.keys()).map((e) =>
			parseInt(e.replace("E", "").replace("e", "")),
		);
		const highestEpisode = Math.max(...episodes);
		const missingEpisodes = highestEpisode - episodes.length;
		if (
			useFilters &&
			missingEpisodes / highestEpisode > 1 - seasonFromEpisodes
		) {
			logReason(
				`Skipping virtual searchee for ${key} episodes as there are too many missing: ${missingEpisodes}/${highestEpisode}`,
			);
			continue;
		}
		const seasonSearchee: Searchee = { name: key, files: [], length: 0 };
		let newestFileAge = 0;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		for (const [_, searchees] of episodeSearchees) {
			let totalEpisodeLength = 0;
			let validSearchees = 0;
			for (const searchee of searchees) {
				let sourceRoot: string;
				if (searchee.path) {
					sourceRoot = searchee.path;
				} else {
					const savePath = torrentSavePaths.get(searchee.infoHash!);
					if (!savePath) continue;
					sourceRoot = join(
						savePath,
						searchee.files.length === 1
							? searchee.files[0].path
							: searchee.name,
					);
				}
				if (!existsSync(sourceRoot)) continue;
				const largestFile = getLargestFile(searchee);
				const absoluteFile: File = {
					length: largestFile.length,
					name: largestFile.name,
					path: statSync(sourceRoot).isFile()
						? sourceRoot
						: join(dirname(sourceRoot), largestFile.path),
				};
				if (!existsSync(absoluteFile.path)) continue;
				seasonSearchee.files.push(absoluteFile);
				totalEpisodeLength += absoluteFile.length;
				validSearchees++;
				newestFileAge = Math.max(
					newestFileAge,
					statSync(absoluteFile.path).mtimeMs,
				);
			}
			if (validSearchees === 0) continue;
			seasonSearchee.length += Math.round(
				totalEpisodeLength / validSearchees,
			);
		}
		if (seasonSearchee.files.length === 0) {
			logReason(
				`Skipping virtual searchee for ${key} episodes as no files were found`,
			);
			continue;
		}
		if (useFilters && Date.now() - newestFileAge < ms("8 days")) {
			logReason(
				`Skipping virtual searchee for ${key} episodes as some are too new: ${new Date(newestFileAge).toISOString()}`,
			);
			continue;
		}
		logReason(
			`Created virtual searchee for ${key} ${episodeSearchees.size} episodes (${seasonSearchee.files.length} files) [${humanReadableSize(seasonSearchee.length)}]`,
		);
		seasonSearchee.source = SearchSource.INDEX;
		seasonSearchees.push(seasonSearchee);
	}
	logReason(`Created ${seasonSearchees.length} virtual season searchees...`);

	return seasonSearchees;
}
