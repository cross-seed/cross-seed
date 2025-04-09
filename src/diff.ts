import { deepStrictEqual } from "assert";
import { parseTorrentFromFilename } from "./torrent.js";

function diff(thing1, thing2) {
	console.log(
		"Use `cross-seed tree` on each .torrent file to display their full structure",
	);
	try {
		deepStrictEqual(thing1, thing2);
		console.log(thing1);
		console.log("Torrents are equal");
	} catch (e) {
		console.log(e);
	}
}

export async function diffCmd(first: string, second: string): Promise<void> {
	const f1 = (await parseTorrentFromFilename(first)).files;
	const f2 = (await parseTorrentFromFilename(second)).files;
	const sortBy =
		f1.length === 1
			? (a, b) => b.length - a.length
			: f2.length === 1
				? (a, b) => a.length - b.length
				: (a, b) => a.path.localeCompare(b.path);
	return diff(f1.sort(sortBy), f2.sort(sortBy));
}
