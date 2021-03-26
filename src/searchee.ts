import { sortBy } from "lodash";
import { Metafile } from "parse-torrent";
import path, { join } from "path";
import { getRuntimeConfig } from "./runtimeConfig";
import { parseTorrentFromFilename } from "./torrent";

interface File {
	length: number;
	name: string;
	path: string;
}

export interface Searchee {
	infoHash?: string;
	path?: string;
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
			path: pathSegments.join(path.sep),
		};
	});

	return sortBy(unsortedFiles, "path");
}

export function createSearcheeFromTorrentFile(filename: string): Searchee {
	const { torrentDir } = getRuntimeConfig();
	const fullPath = join(torrentDir, filename);
	const meta = parseTorrentFromFilename(fullPath);
	return {
		files: getFilesFromTorrent(meta),
		infoHash: meta.infoHash,
		name: meta.name,
		length: meta.length,
	};
}
