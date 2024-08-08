import { basename, dirname, join, relative } from "path";
import ms from "ms";
import { existsSync, readdirSync, statSync } from "fs";
import { getClient } from "./clients/TorrentClient.js";
import {
	ANIME_REGEX,
	ANIME_GROUP_REGEX,
	ARR_DIR_REGEX,
	EP_REGEX,
	RELEASE_GROUP_REGEX,
	SEASON_REGEX,
	RES_STRICT_REGEX,
	parseSource,
	SONARR_SUBFOLDERS_REGEX,
	MOVIE_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { parseTorrentFromFilename } from "./torrent.js";
import {
	createKeyTitle,
	extractInt,
	filesWithExt,
	getLogString,
	getLargestFile,
	hasExt,
	humanReadableDate,
	humanReadableSize,
	isBadTitle,
	stripExtension,
	WithRequired,
} from "./utils.js";

export interface File {
	length: number;
	name: string;
	path: string;
}

export type SearcheeLabel =
	| Label.SEARCH
	| Label.RSS
	| Label.INJECT
	| Label.ANNOUNCE
	| Label.WEBHOOK;

export interface Searchee {
	/**
	 * If searchee is torrent based, !infoHash && !path for virtual
	 */
	infoHash?: string;
	/**
	 * If searchee is data based, !infoHash && !path for virtual
	 */
	path?: string;
	files: File[];
	/**
	 * Original name. Use when interacting with path on disk or client logging
	 * e.g. during the action stage for sourceRoot
	 */
	name: string;
	/**
	 * Usually name but can differ if we can parse something better.
	 * e.g. Season 7 -> Show S7
	 */
	title: string;
	length: number;
	label?: SearcheeLabel;
}

export type SearcheeWithInfoHash = WithRequired<Searchee, "infoHash">;
export type SearcheeWithLabel = WithRequired<Searchee, "label">;

export function hasInfoHash(
	searchee: Searchee,
): searchee is SearcheeWithInfoHash {
	return searchee.infoHash != null;
}

enum SearcheeSource {
	TORRENT = "torrentDir",
	DATA = "dataDir",
	VIRTUAL = "virtual",
}

export function getSearcheeSource(searchee: Searchee): SearcheeSource {
	if (searchee.infoHash) {
		return SearcheeSource.TORRENT;
	} else if (searchee.path) {
		return SearcheeSource.DATA;
	} else {
		return SearcheeSource.VIRTUAL;
	}
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

/**
 * Parse title from SXX or Season XX. Return null if no title found.
 * Also tries to parse titles that are just `Show`, returns `Show` if better not found.
 * @param name Original name of the searchee/metafile
 * @param files files in the searchee
 * @param path if data based, the path to the searchee
 */
export function parseTitle(
	name: string,
	files: File[],
	path?: string,
): string | null {
	const seasonMatch =
		name.length < 12 ? name.match(SONARR_SUBFOLDERS_REGEX) : null;
	if (
		!seasonMatch &&
		(name.match(/\d/) || !hasExt(files, VIDEO_EXTENSIONS))
	) {
		return name;
	}

	const videoFiles = filesWithExt(files, VIDEO_EXTENSIONS);
	for (const videoFile of videoFiles) {
		const ep = videoFile.name.match(EP_REGEX);
		if (ep) {
			const seasonVal =
				ep.groups!.season ??
				ep.groups!.year ??
				seasonMatch?.groups!.seasonNum;
			const season = seasonVal ? `S${extractInt(seasonVal)}` : "";
			const episode =
				videoFiles.length === 1
					? `E${ep.groups!.episode ? extractInt(ep.groups!.episode) : `${ep.groups!.month}.${ep.groups!.day}`}`
					: "";
			if (season.length || episode.length || !seasonMatch) {
				return `${ep.groups!.title} ${season}${episode}`.trim();
			}
		}
		if (path && seasonMatch) {
			const title = basename(dirname(path)).match(ARR_DIR_REGEX)?.groups
				?.title;
			if (title?.length) {
				return `${title} S${seasonMatch.groups!.seasonNum}`;
			}
		}
		const anime = videoFile.name.match(ANIME_REGEX);
		if (anime) {
			const season = seasonMatch
				? `S${seasonMatch.groups!.seasonNum}`
				: "";
			if (season.length || !seasonMatch) {
				return `${anime.groups!.title} ${season}`.trim();
			}
		}
	}
	return !seasonMatch ? name : null;
}

export function createSearcheeFromMetafile(
	meta: Metafile,
): Result<Searchee, Error> {
	const title = parseTitle(meta.name, meta.files);
	if (title) {
		return resultOf({
			files: meta.files,
			infoHash: meta.infoHash,
			name: meta.name,
			title,
			length: meta.length,
		});
	}
	const msg = `Could not find title for ${getLogString(meta)} from child files`;
	logger.verbose({
		label: Label.PREFILTER,
		message: msg,
	});
	return resultOfErr(new Error(msg));
}

export async function createSearcheeFromTorrentFile(
	filepath: string,
): Promise<Result<Searchee, Error>> {
	try {
		const meta = await parseTorrentFromFilename(filepath);
		return createSearcheeFromMetafile(meta);
	} catch (e) {
		logger.error(`Failed to parse ${basename(filepath)}`);
		logger.debug(e);
		return resultOfErr(e);
	}
}

export async function createSearcheeFromPath(
	root: string,
): Promise<Result<Searchee, Error>> {
	const files = getFilesFromDataRoot(root);
	if (files.length === 0) {
		const msg = `No files found in ${root}`;
		logger.verbose({
			label: Label.PREFILTER,
			message: msg,
		});
		return resultOfErr(new Error(msg));
	}
	const totalLength = files.reduce<number>(
		(runningTotal, file) => runningTotal + file.length,
		0,
	);

	const name = basename(root);
	const title = parseTitle(name, files, root);
	if (title) {
		return resultOf({
			files: files,
			path: root,
			name,
			title,
			length: totalLength,
		});
	}
	const msg = `Could not find title for ${root} in parent directory or child files`;
	logger.verbose({
		label: Label.PREFILTER,
		message: msg,
	});
	return resultOfErr(new Error(msg));
}

export function getKeyMetaInfo(stem: string): string {
	const resM = stem.match(RES_STRICT_REGEX)?.groups?.res;
	const res = resM ? `.${resM}` : "";
	const sourceM = parseSource(stem);
	const source = sourceM ? `.${sourceM}` : "";
	const groupM = stem.match(RELEASE_GROUP_REGEX)?.groups?.group;
	if (groupM) {
		return `${res}${source}-${groupM}`.toLowerCase();
	}
	const groupAnimeM = stem.match(ANIME_GROUP_REGEX)?.groups?.group;
	if (groupAnimeM) {
		return `${res}${source}-${groupAnimeM}`.toLowerCase();
	}
	return `${res}${source}`.toLowerCase();
}

export function getMovieKey(stem: string): {
	ensembleTitle: string;
	keyTitle: string;
	year: number;
} | null {
	const match = stem.match(MOVIE_REGEX);
	if (!match) return null;
	const keyTitle = createKeyTitle(match.groups!.title);
	if (!keyTitle) return null;
	const year = extractInt(match.groups!.year);
	const ensembleTitle = `${match.groups!.title}.${year}`;
	return { ensembleTitle, keyTitle, year };
}

export function getSeasonKey(stem: string): {
	ensembleTitle: string;
	keyTitle: string;
	season: string;
} | null {
	const match = stem.match(SEASON_REGEX);
	if (!match) return null;
	const keyTitle = createKeyTitle(match.groups!.title);
	if (!keyTitle) return null;
	const season = `S${extractInt(match.groups!.season)}`;
	const ensembleTitle = `${match.groups!.title}.${season}`;
	return { ensembleTitle, keyTitle, season };
}

export function getEpisodeKey(stem: string): {
	ensembleTitle: string;
	keyTitle: string;
	season: string | undefined;
	episode: number | string;
} | null {
	const match = stem.match(EP_REGEX);
	if (!match) return null;
	const keyTitle = createKeyTitle(match.groups!.title);
	if (!keyTitle) return null;
	const season = match!.groups!.season
		? `S${extractInt(match!.groups!.season)}`
		: match!.groups!.year
			? `S${match!.groups!.year}`
			: undefined;
	const ensembleTitle = `${match!.groups!.title}${season ? `.${season}` : ""}`;
	const episode = match!.groups!.episode
		? extractInt(match!.groups!.episode)
		: `${match!.groups!.month}.${match!.groups!.day}`;
	return { ensembleTitle, keyTitle, season, episode };
}

export function getAnimeKeys(stem: string): {
	ensembleTitles: string[];
	keyTitles: string[];
	release: number;
} | null {
	const match = stem.match(ANIME_REGEX);
	if (!match) return null;
	const firstTitle = match!.groups!.title;
	const altTitle = match!.groups!.altTitle;
	const keyTitles: string[] = [];
	const ensembleTitles: string[] = [];
	for (const title of [firstTitle, altTitle]) {
		if (!title) continue;
		if (isBadTitle(title)) continue;
		const keyTitle = createKeyTitle(title);
		if (!keyTitle) continue;
		keyTitles.push(keyTitle);
		ensembleTitles.push(title);
	}
	if (keyTitles.length === 0) return null;
	const release = extractInt(match!.groups!.release);
	return { ensembleTitles, keyTitles, release };
}

export async function createEnsembleSearchees(
	allSearchees: SearcheeWithLabel[],
	options: { useFilters: boolean },
): Promise<SearcheeWithLabel[]> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	if (!seasonFromEpisodes) return [];

	const logReason = (reason: string): void => {
		if (!options.useFilters) return;
		logger.verbose({
			label: Label.PREFILTER,
			message: reason,
		});
	};
	logReason(`Creating virtual searchees for seasons...`);

	// Don't create virtual searchees for existing seasons
	const seasonsMap = new Map<string, SearcheeWithLabel[]>();
	if (options.useFilters) {
		for (const searchee of allSearchees) {
			const stem = stripExtension(searchee.name);
			const seasonKey = getSeasonKey(stem);
			if (!seasonKey) continue;
			const info = getKeyMetaInfo(stem);
			const key = `${seasonKey.keyTitle}.${seasonKey.season}${info}`;
			if (!seasonsMap.has(key)) {
				seasonsMap.set(key, []);
			}
			seasonsMap.get(key)!.push(searchee);
		}
	}

	// Organize episodes by {key: {episode: [searchee]}}
	const keyMap = new Map<string, Map<number | string, SearcheeWithLabel[]>>();
	const ensembleTitleMap = new Map<string, string>();
	const parseKeys = (
		searchee: SearcheeWithLabel,
		keys: string[],
		ensembleTitles: string[],
		episode: number | string,
	): void => {
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			if (seasonsMap.has(key)) continue;
			if (!ensembleTitleMap.has(key)) {
				ensembleTitleMap.set(key, ensembleTitles[i]);
			}
			const episodesMap = keyMap.get(key);
			if (!episodesMap) {
				keyMap.set(key, new Map([[episode, [searchee]]]));
				continue;
			}
			const episodeSearchees = episodesMap.get(episode);
			if (!episodeSearchees) {
				episodesMap.set(episode, [searchee]);
				continue;
			}
			episodeSearchees.push(searchee);
		}
	};
	for (const searchee of allSearchees) {
		const stem = stripExtension(searchee.name);
		const episodeKey = getEpisodeKey(stem);
		if (episodeKey) {
			const info = getKeyMetaInfo(stem);
			const key = `${episodeKey.keyTitle}${episodeKey.season ? `.${episodeKey.season}` : ""}${info}`;
			const ensembleTitle = `${episodeKey.ensembleTitle}${info}`;
			parseKeys(searchee, [key], [ensembleTitle], episodeKey.episode);
			if (options.useFilters) continue;
		}
		if (options.useFilters && SEASON_REGEX.test(stem)) continue;
		const animeKeys = getAnimeKeys(stem);
		if (animeKeys) {
			const info = getKeyMetaInfo(stem);
			const keys = animeKeys.keyTitles.map((k) => `${k}${info}`);
			const ensembleTitles = animeKeys.ensembleTitles.map(
				(t) => `${t}${info}`,
			);
			parseKeys(searchee, keys, ensembleTitles, animeKeys.release);
			if (options.useFilters) continue;
		}
	}

	const torrentSavePaths = await getClient().getAllDownloadDirs({
		metas: allSearchees.filter(hasInfoHash) as SearcheeWithInfoHash[],
		onlyCompleted: false,
	});

	// Create virtual searchees for seasons
	const seasonSearchees: SearcheeWithLabel[] = [];
	for (const [key, episodeSearchees] of keyMap) {
		if (options.useFilters && episodeSearchees.size < 3) {
			continue;
		}
		const ensembleTitle = ensembleTitleMap.get(key)!;
		const episodes = Array.from(episodeSearchees.keys());
		if (typeof episodes[0] === "number") {
			const highestEpisode = Math.max(...(episodes as number[]));
			const availPct = episodes.length / highestEpisode;
			if (options.useFilters && availPct < seasonFromEpisodes) {
				logReason(
					`Skipping virtual searchee for ${ensembleTitle} episodes as there's only ${episodes.length}/${highestEpisode} (${availPct.toFixed(2)} < ${seasonFromEpisodes.toFixed(2)})`,
				);
				continue;
			}
		}
		const seasonSearchee: SearcheeWithLabel = {
			name: ensembleTitle,
			title: ensembleTitle,
			files: [], // Can have multiple files per episode
			length: 0, // Total length of episodes (average if multiple files for episode)
			label: allSearchees[0].label,
		};
		let newestFileAge = 0;
		for (const [, searchees] of episodeSearchees) {
			const episodeFiles: File[] = [];
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

				// Use the oldest file for episode if dupe (cross seeds)
				const duplicateFile = episodeFiles.find(
					(file) => file.length === absoluteFile.length,
				);
				if (duplicateFile) {
					const dupeFileAge = statSync(duplicateFile.path).mtimeMs;
					const newFileAge = statSync(absoluteFile.path).mtimeMs;
					if (dupeFileAge <= newFileAge) continue;
					episodeFiles.splice(episodeFiles.indexOf(duplicateFile), 1);
				}
				episodeFiles.push(absoluteFile);
			}
			if (episodeFiles.length === 0) continue;
			const total = episodeFiles.reduce((a, b) => a + b.length, 0);
			seasonSearchee.length += Math.round(total / episodeFiles.length);
			seasonSearchee.files.push(...episodeFiles);
			const fileAges = episodeFiles.map((f) => statSync(f.path).mtimeMs);
			newestFileAge = Math.max(newestFileAge, ...fileAges);
		}
		if (seasonSearchee.files.length === 0) {
			logReason(
				`Skipping virtual searchee for ${ensembleTitle} episodes as no files were found`,
			);
			continue;
		}
		if (options.useFilters && Date.now() - newestFileAge < ms("8 days")) {
			logReason(
				`Skipping virtual searchee for ${ensembleTitle} episodes as some are too new: ${humanReadableDate(newestFileAge)}`,
			);
			continue;
		}
		logReason(
			`Created virtual searchee for ${ensembleTitle}: ${episodeSearchees.size} episodes - ${seasonSearchee.files.length} files - ${humanReadableSize(seasonSearchee.length)}`,
		);
		seasonSearchees.push(seasonSearchee);
	}
	logReason(`Created ${seasonSearchees.length} virtual season searchees...`);

	return seasonSearchees;
}
