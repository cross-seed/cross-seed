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

function getDirectorySize(filepath: string): number {
	const files : string[] = getDirectoryFiles(filepath, []);
	var totalSize : number = 0;
	files.forEach(file => totalSize += fs.statSync(file).size);
	return totalSize;
}

function getDirectoryFiles(dirPath, arrayOfFiles): string[] {
	const files = fs.readdirSync(dirPath)
  
	arrayOfFiles = arrayOfFiles || []
  
	files.forEach(function(file) {
	  if (fs.statSync(dirPath + "/" + file).isDirectory()) {
		arrayOfFiles = getDirectoryFiles(dirPath + "/" + file, arrayOfFiles)
	  } else {
		arrayOfFiles.push(path.join(dirPath, file))
	  }
	})
  
	return arrayOfFiles
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
		//const rawPathSegments: Buffer[] = filepath["path.utf-8"] || filepath;
		//const pathSegments = rawPathSegments.map((s) => s.toString());

		const fileName : string = filepath.split(path.sep)[filepath.split(path.sep).length-1];
		const length : number = fs.statSync(filepath).isDirectory() ? getDirectorySize(filepath) : fs.statSync(filepath).size;
		if (fs.statSync(filepath).isDirectory()){
			const files = getDirectoryFiles(filepath, [])
		}
		

		return {
			files:  [{
				name: fileName,
				path: fileName,
				length: length,
			}],
			path: filepath,
			name: fileName,
			length: length,
		};
	// } catch (e) {
	// 	logger.error(`Failed to parse ${basename(filepath)}`);
	// 	logger.debug(e);
	// 	return e;
	// }
} // file obj is just name, path, length

