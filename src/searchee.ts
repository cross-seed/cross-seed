import { readdirSync, statSync } from "fs";
import { sortBy } from "lodash-es";
import { Metafile } from "parse-torrent";
import { basename, join, relative, sep as osSpecificPathSeparator } from "path";
import { logger } from "./logger.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { parseTorrentFromFilename } from "./torrent.js";

export interface File {
	length: number;
	name: string;
	path: string;
}

export interface Searchee {
	infoHash?: string; // if searchee is torrent based
	path?: string; // if searchee is data based
	files: File[];
	name: string;
	length: number;
}

function getFileNamesFromRootRec(root: string, isDirHint?: boolean): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
	if (isDir) {
		return readdirSync(root, { withFileTypes: true }).flatMap((dirent) =>
			getFileNamesFromRootRec(
				join(root, dirent.name),
				dirent.isDirectory()
			)
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

export function getFiles(meta: Metafile): File[] {
	if (!meta.info.files) {
		return [
			{
				name: meta.name,
				path: meta.name,
				length: meta.length,
			},
		];
	}

	const unsortedFiles = meta.info.files.map((file) => {
		const rawPathSegments: Buffer[] = file["path.utf-8"] || file.path;
		const pathSegments = rawPathSegments.map((s) => s.toString());
		return {
			name: pathSegments[pathSegments.length - 1],
			length: file.length,
			// Note that we don't use path.join here because of
			// https://github.com/cross-seed/cross-seed/issues/46.
			// path.join ignores zero-length path segments,
			// which we do not want.
			path: [meta.name, ...pathSegments].join(osSpecificPathSeparator),
		};
	});

	return sortBy(unsortedFiles, "path");
}

export function createSearcheeFromMetafile(meta: Metafile): Searchee {
	return {
		files: getFiles(meta),
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
	};
}

export async function createSearcheeFromTorrentFile(
	filepath: string
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
	filepath: string
): Promise<Result<Searchee, Error>> {
	const totalLength = getFilesFromDataRoot(filepath).reduce<number>(
		(runningTotal, file) => runningTotal + file.length,
		0
	);
	return resultOf({
		files: getFilesFromDataRoot(filepath),
		path: filepath,
		name: basename(filepath),
		length: totalLength,
	});
}
