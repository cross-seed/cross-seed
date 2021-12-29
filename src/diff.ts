import { createSearcheeFromMetafile } from "./searchee.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { deepStrictEqual } from "assert";

function diff(thing1, thing2) {
	try {
		deepStrictEqual(thing1, thing2);
		console.log(thing1);
		console.log("Torrents are equal");
	} catch (e) {
		console.log(e);
	}
}

export async function diffCmd(first: string, second: string): Promise<void> {
	const firstMeta = await parseTorrentFromFilename(first);
	const secondMeta = await parseTorrentFromFilename(second);
	const firstSearchee = await createSearcheeFromMetafile(firstMeta);
	const secondSearchee = await createSearcheeFromMetafile(secondMeta);
	delete firstSearchee.infoHash;
	delete secondSearchee.infoHash;
	diff(firstSearchee, secondSearchee);
}
