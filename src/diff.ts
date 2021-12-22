import { Command } from "commander";
import { logger } from "./logger.js";
import { createSearcheeFromMetafile } from "./searchee.js";
import { parseTorrentFromFilename } from "./torrent.js";
import { deepStrictEqual } from "assert";

function diff(thing1, thing2) {
	try {
		deepStrictEqual(thing1, thing2);
		logger.info("Torrents are equal");
	} catch (e) {
		logger.info("Torrents do not match");
	}
}

export async function diffCmd(
	options: Record<string, unknown>,
	cmd: Command
): Promise<void> {
	const [first, second] = cmd.args;

	const firstMeta = await parseTorrentFromFilename(first);
	const secondMeta = await parseTorrentFromFilename(second);
	const firstSearchee = await createSearcheeFromMetafile(firstMeta);
	const secondSearchee = await createSearcheeFromMetafile(secondMeta);
	diff(firstSearchee, secondSearchee);
}
