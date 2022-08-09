import { sortBy } from "lodash-es";
import { Metafile } from "parse-torrent";
import { basename, sep as osSpecificPathSeparator } from "path";
import { parseTorrentFromFilename } from "./torrent.js";
import { Result } from "./utils.js";
import { logger } from "./logger.js";

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
			path: [meta.name, ...pathSegments].join(osSpecificPathSeparator),
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
