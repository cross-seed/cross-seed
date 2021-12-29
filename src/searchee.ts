import { sortBy } from "lodash-es";
import { Metafile } from "parse-torrent";
import path, { join } from "path";
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
			// https://github.com/mmgoodnow/cross-seed/issues/46.
			// path.join ignores zero-length path segments,
			// which we do not want.
			path: [meta.name, ...pathSegments].join(path.sep),
		};
	});

	return sortBy(unsortedFiles, "path");
}

export async function createSearcheeFromMetafile(
	meta: Metafile
): Promise<Searchee> {
	return {
		files: getFilesFromTorrent(meta),
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
	};
}

export async function createSearcheeFromTorrentFile(
	filename: string
): Promise<Result<Searchee>> {
	const { torrentDir } = getRuntimeConfig();
	const fullPath = join(torrentDir, filename);
	try {
		const meta = await parseTorrentFromFilename(fullPath);
		return createSearcheeFromMetafile(meta);
	} catch (e) {
		logger.error(`Failed to parse ${filename}`);
		logger.debug(e);
		return e;
	}
}
