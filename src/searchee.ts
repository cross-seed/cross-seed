import { Metafile } from "parse-torrent";
import { join } from "path";
import { getRuntimeConfig } from "./runtimeConfig";
import { loadTorrentDir, parseTorrentFromFilename } from "./torrent";
import { set } from "lodash";

interface FileTree {
	[filename: string]: number | FileTree;
}

interface Searchee {
	infoHash?: string;
	fileTree: FileTree;
	name: string;
}

function getFileTree(meta: Metafile): FileTree {
	if (!meta.info.files) return { [meta.name]: meta.length };
	return meta.info.files.reduce((acc, file) => {
		const pathSegments: Buffer[] = file["path.utf-8"] || file.path;
		return set(
			acc,
			[meta.name, ...pathSegments.map((s) => s.toString())],
			file.length
		);
	}, {});
}

function createSearcheefromTorrentFile(filename: string): Searchee {
	const { torrentDir } = getRuntimeConfig();
	const fullPath = join(torrentDir, filename);
	const meta = parseTorrentFromFilename(fullPath);
	return {
		fileTree: getFileTree(meta),
		infoHash: meta.infoHash,
		name: meta.name,
	};
}
