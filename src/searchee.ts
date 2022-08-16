import { sortBy } from "lodash-es";
import fs, { fstatSync } from "fs";
import { Metafile } from "parse-torrent";
import path, { join, basename } from "path";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { Result } from "./utils.js";
import { logger } from "./logger.js";
interface File {
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

export function getFilePathsFromPath(dirPath, arrayOfFiles, depth, depthLimit) {
	var files = fs.readdirSync(dirPath)

	arrayOfFiles = arrayOfFiles || []

	files.forEach(function(file) {
		arrayOfFiles.push(path.join(dirPath, file))
		if (fs.statSync(dirPath + "/" + file).isDirectory() && depth < depthLimit) {
			arrayOfFiles = getFilePathsFromPath(
				dirPath + "/" + file, 
				arrayOfFiles, 
				depth + 1, 
				depthLimit
			)
		} 
		
	})

	return arrayOfFiles
}

function getFilesFromDataRoot(rootPath): File[] {
	if (fs.statSync(rootPath).isDirectory()) {
		var files: string[] = getFilePathsFromPath(rootPath, [], 0, 100); // This doesn't produce multiple searchees, so it can go
	} else { 															  // as deep as it needs.
		var files: string[] = [rootPath];
	}
	var torrentFiles: File[] = [];
	files.forEach(file => torrentFiles.push(
		{
			path: path.relative(path.join(rootPath, ".."), file),
        	name: path.basename(file),
			length : fs.statSync(file).size
		})
	)
	return torrentFiles
  }

function getFilesFromTorrent(meta: Metafile): File[] {
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
			path: [meta.name, ...pathSegments].join(path.sep),
		};
	});

	return sortBy(unsortedFiles, "path");
}

export function createSearcheeFromMetafile(meta: Metafile): Searchee {
	return {
		files: getFilesFromTorrent(meta),
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
	};
}

export async function createSearcheeFromTorrentFile(
	filepath: string
): Promise<Result<Searchee>> {
	try {
		const meta = await parseTorrentFromFilename(filepath);
		return createSearcheeFromMetafile(meta);
	} catch (e) {
		logger.error(`Failed to parse ${basename(filepath)}`);
		logger.debug(e);
		return e;
	}
}

export async function createSearcheeFromPath(
	filepath: string
): Promise<Result<Searchee>> {
		const fileName : string = path.basename(filepath);
		const fileList : File[] = getFilesFromDataRoot(filepath);
		var totalLength = fileList.reduce<number>((runningTotal, file) => runningTotal + file.length, 0);
		return {
			files:  fileList,
			path: filepath,
			name: fileName,
			length: totalLength,
		};
} 

