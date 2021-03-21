import { Metafile } from "parse-torrent";
import { join } from "path";
import { getRuntimeConfig } from "./runtimeConfig";
import { loadTorrentDir, parseTorrentFromFilename } from "./torrent";

interface FileTree {
	[filename: string]: number | FileTree;
}

interface Searchee {
	infoHash?: string;
	fileTree: FileTree;
	name: string;
}

function getFileTree(meta: Metafile): FileTree {}

function createSearcheefromTorrentFile(filename: string): Searchee {
	const { torrentDir } = getRuntimeConfig();
	const fullPath = join(torrentDir, filename);
	const meta = parseTorrentFromFilename(fullPath);
}
