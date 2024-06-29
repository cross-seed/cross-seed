import { readdirSync, statSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { WithRequired } from "./utils.js";
import {
	ANIME_REGEX,
	ARR_DIR_REGEX,
	EP_REGEX,
	SONARR_SUBFOLDERS_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";

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
