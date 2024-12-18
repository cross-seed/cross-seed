import { readdirSync, statSync } from "fs";
import { stat } from "fs/promises";
import { basename, dirname, join, relative } from "path";
import { TorrentMetadataInClient } from "./clients/TorrentClient.js";
import {
	ANIME_GROUP_REGEX,
	ANIME_REGEX,
	ARR_DIR_REGEX,
	BAD_GROUP_PARSE_REGEX,
	EP_REGEX,
	MOVIE_REGEX,
	parseSource,
	RELEASE_GROUP_REGEX,
	RES_STRICT_REGEX,
	SEASON_REGEX,
	SONARR_SUBFOLDERS_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { parseTorrentWithMetadata } from "./torrent.js";
import {
	createKeyTitle,
	extractInt,
	filesWithExt,
	getLogString,
	hasExt,
	isBadTitle,
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
	 * If searchee is torrent based
	 */
	infoHash?: string;
	/**
	 * If searchee is data based
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
	category?: string;
	tags?: string[];
	trackers?: string[][];
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

export function getLargestFile(files: File[]): File {
	return files.reduce((a, b) => (a.length > b.length ? a : b));
}

export async function getNewestFileAge(searchee: Searchee): Promise<number> {
	if (searchee.infoHash || searchee.path) {
		throw new Error("Only virtual searchees have absolute paths");
	}
	return Math.max(
		...(await Promise.all(
			searchee.files.map((file) =>
				stat(file.path).then((s) => s.mtimeMs),
			),
		)),
	);
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
	const parentDir = dirname(rootPath);
	try {
		return getFileNamesFromRootRec(rootPath).map((file) => ({
			path: relative(parentDir, file),
			name: basename(file),
			length: statSync(file).size,
		}));
	} catch (e) {
		logger.debug(e);
		return [];
	}
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
): Result<SearcheeWithInfoHash, Error> {
	const title = parseTitle(meta.name, meta.files);
	if (title) {
		return resultOf({
			files: meta.files,
			infoHash: meta.infoHash,
			name: meta.name,
			title,
			length: meta.length,
			category: meta.category,
			tags: meta.tags,
			trackers: meta.trackers,
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
	torrentInfos: TorrentMetadataInClient[],
): Promise<Result<SearcheeWithInfoHash, Error>> {
	try {
		const meta = await parseTorrentWithMetadata(filepath, torrentInfos);
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
		const msg = `Failed to retrieve files in ${root}`;
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
	const groupM = getReleaseGroup(stem);
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

export function getReleaseGroup(stem: string): string | null {
	const predictedGroupMatch = stem.match(RELEASE_GROUP_REGEX);
	if (!predictedGroupMatch) {
		return null;
	}
	const parsedGroupMatchString = predictedGroupMatch!.groups!.group.trim();
	return BAD_GROUP_PARSE_REGEX.test(parsedGroupMatchString)
		? null
		: parsedGroupMatchString;
}
