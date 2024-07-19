import { readdirSync, statSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
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
	NON_UNICODE_ALPHANUM_REGEX,
	VIDEO_EXTENSIONS,
	YEAR_REGEX,
} from "./constants.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { parseTorrentFromFilename } from "./torrent.js";
import {
	extractInt,
	isBadTitle,
	reformatTitleForSearching,
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
	| Label.ANNOUNCE
	| Label.WEBHOOK;

export interface Searchee {
	// if searchee is torrent based
	infoHash?: string;
	// if searchee is data based
	path?: string;
	files: File[];
	name: string;
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

export function createSearcheeFromMetafile(meta: Metafile): Searchee {
	return {
		files: meta.files,
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
	};
}

export async function createSearcheeFromTorrentFile(
	filepath: string,
): Promise<Result<Searchee, Error>> {
	try {
		const meta = await parseTorrentFromFilename(filepath);
		return resultOf(createSearcheeFromMetafile(meta));
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

	const baseName = basename(root);
	const seasonMatch =
		baseName.length < 12 ? baseName.match(SONARR_SUBFOLDERS_REGEX) : null;
	if (!seasonMatch) {
		return resultOf({
			files: files,
			path: root,
			name: baseName,
			length: totalLength,
		});
	}
	// Name is just SXX or Season XX, need to find title above or below
	const videoFile = files.find((file) =>
		VIDEO_EXTENSIONS.includes(extname(file.name)),
	);

	const title =
		videoFile?.name.match(EP_REGEX)?.groups?.title ??
		basename(dirname(root)).match(ARR_DIR_REGEX)?.groups?.title ??
		videoFile?.name.match(ANIME_REGEX)?.groups?.title;
	if (!title) {
		const msg = `Could not find title for ${root} in parent directory or child files`;
		logger.verbose({
			label: Label.PREFILTER,
			message: msg,
		});
		return resultOfErr(new Error(msg));
	}

	return resultOf({
		files: files,
		path: root,
		name: `${title} S${seasonMatch.groups!.seasonNum}`,
		length: totalLength,
	});
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
	const keyTitle = reformatTitleForSearching(match.groups!.title)
		.replace(NON_UNICODE_ALPHANUM_REGEX, "")
		.toLowerCase();
	if (!keyTitle.length) return null;
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
	const keyTitle = reformatTitleForSearching(match.groups!.title)
		.replace(YEAR_REGEX, "")
		.replace(NON_UNICODE_ALPHANUM_REGEX, "")
		.toLowerCase();
	if (!keyTitle.length) return null;
	const season = `S${extractInt(match.groups!.season)}`;
	const ensembleTitle = `${match.groups!.title}.${season}`;
	return { ensembleTitle, keyTitle, season };
}

export function getEpisodeKey(stem: string): {
	ensembleTitle: string;
	keyTitle: string;
	season: string;
	episode: number | string;
} | null {
	const match = stem.match(EP_REGEX);
	if (!match) return null;
	const keyTitle = reformatTitleForSearching(match!.groups!.title)
		.replace(YEAR_REGEX, "")
		.replace(NON_UNICODE_ALPHANUM_REGEX, "")
		.toLowerCase();
	if (!keyTitle.length) return null;
	const seasonM = match!.groups!.season;
	const season = seasonM
		? `S${extractInt(seasonM)}`
		: `S${match!.groups!.year}`;
	const ensembleTitle = `${match!.groups!.title}.${season}`;
	const episode = seasonM
		? extractInt(match!.groups!.episode)
		: `${match!.groups!.month}/${match!.groups!.day}`;
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
		const keyTitle = reformatTitleForSearching(title)
			.replace(YEAR_REGEX, "")
			.replace(NON_UNICODE_ALPHANUM_REGEX, "")
			.toLowerCase();
		if (!keyTitle.length) continue;
		keyTitles.push(keyTitle);
		ensembleTitles.push(title);
	}
	if (keyTitles.length === 0) return null;
	const release = extractInt(match!.groups!.release);
	return { ensembleTitles, keyTitles, release };
}
