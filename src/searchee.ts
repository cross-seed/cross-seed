import { basename, dirname, extname, join, relative } from "path";
import ms from "ms";
import { existsSync, readdirSync, statSync } from "fs";
import { getClient } from "./clients/TorrentClient.js";
import {
	ANIME_REGEX,
	ARR_DIR_REGEX,
	EP_REGEX,
	RELEASE_GROUP_REGEX,
	SEASON_REGEX,
	RES_STRICT_REGEX,
	sourceRegexParse,
	SONARR_SUBFOLDERS_REGEX,
	MOVIE_REGEX,
	NON_UNICODE_ALPHANUM_REGEX,
	VIDEO_EXTENSIONS,
	YEAR_REGEX,
} from "./constants.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { parseTorrentFromFilename } from "./torrent.js";
import {
	extractInt,
	getLargestFile,
	humanReadableSize,
	isBadTitle,
	reformatTitleForSearching,
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
	// if searchee is torrent based
	infoHash?: string;
	// if searchee is data based, neither if virtual
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
	// Title is just SXX or Season XX, need to find title above or below
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
		name: `${title} S${seasonMatch?.groups?.seasonNum}`,
		length: totalLength,
	});
}

export function getKeyMetaInfo(stem: string, isAnime: boolean): string {
	const resM = stem.match(RES_STRICT_REGEX)?.groups?.res;
	const res = resM ? `.${resM}` : "";
	const sourceM = sourceRegexParse(stem);
	const source = sourceM ? `.${sourceM}` : "";
	const groupM = stem.match(RELEASE_GROUP_REGEX)?.groups?.group;
	if (groupM) {
		return `${res}${source}-${groupM}`.toLowerCase();
	}
	if (!isAnime) {
		return `${res}${source}`.toLowerCase();
	}
	const groupAnimeM = stem.match(ANIME_REGEX)?.groups?.group;
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
	const keyTitle = reformatTitleForSearching(match.groups!.title, false)
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
	const keyTitle = reformatTitleForSearching(match.groups!.title, false)
		.replace(YEAR_REGEX, "")
		.replace(NON_UNICODE_ALPHANUM_REGEX, "")
		.toLowerCase();
	if (!keyTitle.length) return null;
	const season = `S${extractInt(match.groups!.season)}`;
	const ensembleTitle = `${match.groups!.title}.${season}`;
	return { ensembleTitle, keyTitle, season };
}

export function getEpisodeAndKey(stem: string): {
	ensembleTitle: string;
	keyTitle: string;
	season: string;
	episode: number | string;
} | null {
	const match = stem.match(EP_REGEX);
	if (!match) return null;
	const keyTitle = reformatTitleForSearching(match!.groups!.title, false)
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

export function getReleaseAndKeys(stem: string): {
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
		const keyTitle = reformatTitleForSearching(title, false)
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

export async function createEnsembleSearchees(
	allSearchees: Searchee[],
	useFilters: boolean,
): Promise<Searchee[]> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	if (!seasonFromEpisodes) return [];

	const logReason = (reason: string): void => {
		if (!useFilters) return;
		logger.verbose(reason);
	};
	logReason(`Creating virtual searchees for seasons...`);

	// Don't create virtual searchees for existing seasons
	const seasonsMap = new Map<string, Searchee[]>();
	if (useFilters) {
		for (const searchee of allSearchees) {
			const stem = stripExtension(searchee.name);
			const seasonKey = getSeasonKey(stem);
			if (!seasonKey) continue;
			const info = getKeyMetaInfo(stripExtension(stem), false);
			const key = `${seasonKey.keyTitle}.${seasonKey.season}${info}`;
			if (!seasonsMap.has(key)) {
				seasonsMap.set(key, []);
			}
			seasonsMap.get(key)!.push(searchee);
		}
	}

	// Organize episodes by {key: {episode: [searchee]}}
	const keyMap = new Map<string, Map<number | string, Searchee[]>>();
	const keyTitleMap = new Map<string, string>();
	const parseKeys = (
		searchee: Searchee,
		keys: string[],
		ensembleTitles: string[],
		episode: number | string,
	): void => {
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			if (seasonsMap.has(key)) continue;
			if (!keyTitleMap.has(key)) {
				keyTitleMap.set(key, ensembleTitles[i]);
			}
			const episodesMap = keyMap.get(key);
			if (!episodesMap) {
				keyMap.set(key, new Map([[episode, [searchee]]]));
				continue; // First occurrence of key
			}
			const episodeSearchees = episodesMap.get(episode);
			if (!episodeSearchees) {
				episodesMap.set(episode, [searchee]);
				continue; // First occurrence of episode
			}
			episodeSearchees.push(searchee);
		}
	};
	for (const searchee of allSearchees) {
		const stem = stripExtension(searchee.name);
		const episodeAndKey = getEpisodeAndKey(stem);
		if (episodeAndKey) {
			const info = getKeyMetaInfo(stem, false);
			const key = `${episodeAndKey.keyTitle}.${episodeAndKey.season}${info}`;
			const ensembleTitle = `${episodeAndKey.ensembleTitle}${info}`;
			parseKeys(searchee, [key], [ensembleTitle], episodeAndKey.episode);
			if (useFilters) continue;
		}
		if (useFilters && SEASON_REGEX.test(stem)) continue;
		const releaseAndKeys = getReleaseAndKeys(stem);
		if (releaseAndKeys) {
			const info = getKeyMetaInfo(stem, true);
			const keys = releaseAndKeys.keyTitles.map((k) => `${k}${info}`);
			const ensembleTitles = releaseAndKeys.ensembleTitles.map(
				(t) => `${t}${info}`,
			);
			parseKeys(searchee, keys, ensembleTitles, releaseAndKeys.release);
			if (useFilters) continue;
		}
	}

	const torrentSavePaths = await getClient().getAllDownloadDirs(
		false,
		allSearchees.filter(hasInfoHash),
	);

	// Create virtual searchees for seasons
	const seasonSearchees: Searchee[] = [];
	for (const [key, episodeSearchees] of keyMap) {
		if (useFilters && episodeSearchees.size < 3) {
			continue;
		}
		const title = keyTitleMap.get(key)!;
		const episodes = Array.from(episodeSearchees.keys());
		if (typeof episodes[0] === "number") {
			const highestEpisode = Math.max(...(episodes as number[]));
			const availPct = episodes.length / highestEpisode;
			if (useFilters && availPct < seasonFromEpisodes) {
				logReason(
					`Skipping virtual searchee for ${title} episodes as there's only ${episodes.length}/${highestEpisode} (${availPct.toFixed(2)} < ${seasonFromEpisodes.toFixed(2)})`,
				);
				continue;
			}
		}
		const seasonSearchee: Searchee = {
			name: title,
			files: [],
			length: 0,
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
				`Skipping virtual searchee for ${title} episodes as no files were found`,
			);
			continue;
		}
		if (useFilters && Date.now() - newestFileAge < ms("8 days")) {
			logReason(
				`Skipping virtual searchee for ${title} episodes as some are too new: ${new Date(newestFileAge).toISOString()}`,
			);
			continue;
		}
		logReason(
			`Created virtual searchee for ${title}: ${episodeSearchees.size} episodes (${seasonSearchee.files.length} files) [${humanReadableSize(seasonSearchee.length)}]`,
		);
		seasonSearchees.push(seasonSearchee);
	}
	logReason(`Created ${seasonSearchees.length} virtual season searchees...`);

	return seasonSearchees;
}
