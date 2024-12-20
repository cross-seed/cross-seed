import { deepStrictEqual } from "assert";
import { createSearcheeFromMetafile, Searchee } from "./searchee.js";
import { parseTorrentFromFilename } from "./torrent.js";

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
	const firstSearcheeRes = createSearcheeFromMetafile(firstMeta);
	if (firstSearcheeRes.isErr()) {
		console.log(firstSearcheeRes.unwrapErr());
		return;
	}
	const secondSearcheeRes = createSearcheeFromMetafile(secondMeta);
	if (secondSearcheeRes.isErr()) {
		console.log(secondSearcheeRes.unwrapErr());
		return;
	}

	const firstSearchee: Searchee = firstSearcheeRes.unwrap();
	delete firstSearchee.infoHash;
	delete firstSearchee.category;
	delete firstSearchee.tags;
	delete firstSearchee.trackers;

	const secondSearchee: Searchee = secondSearcheeRes.unwrap();
	delete secondSearchee.infoHash;
	delete secondSearchee.category;
	delete secondSearchee.tags;
	delete secondSearchee.trackers;

	diff(firstSearchee, secondSearchee);
}
