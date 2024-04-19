import { readdirSync, statSync } from "fs";
import { basename, join, relative } from "path";
import { logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { WithRequired } from "./utils.js";

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
	filepath: string,
): Promise<Result<Searchee, Error>> {
	const totalLength = getFilesFromDataRoot(filepath).reduce<number>(
		(runningTotal, file) => runningTotal + file.length,
		0,
	);
	return resultOf({
		files: getFilesFromDataRoot(filepath),
		path: filepath,
		name: basename(filepath),
		length: totalLength,
	});
}
