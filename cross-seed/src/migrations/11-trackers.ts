import Knex from "knex";
import { basename, join } from "path";
import { existsSync } from "fs";
import { rename } from "fs/promises";
import { appDir } from "../configuration.js";
import { TORRENT_CACHE_FOLDER } from "../constants.js";
import { getCachedTorrentName } from "../decide.js";
import {
	findAllTorrentFilesInDir,
	parseMetadataFromFilename,
} from "../torrent.js";

async function up(knex: Knex.Knex): Promise<void> {
	const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
	if (existsSync(torrentCacheDir)) {
		const torrentPaths = await findAllTorrentFilesInDir(torrentCacheDir);
		for (const torrentPath of torrentPaths) {
			const { infoHash } = parseMetadataFromFilename(
				basename(torrentPath),
			);
			if (!infoHash) continue;
			await rename(
				torrentPath,
				join(torrentCacheDir, getCachedTorrentName(infoHash)),
			);
		}
	}

	await knex.schema.alterTable("indexer", (table) => {
		table.json("trackers").after("apikey");
	});
	await knex.schema.alterTable("decision", (table) => {
		table.index(["info_hash", "guid"], "idx_decision_info_hash_guid");
		table.index("info_hash", "idx_decision_info_hash");
		table.index("guid", "idx_decision_guid");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", function (table) {
		table.dropColumn("trackers");
	});
	await knex.schema.alterTable("decision", (table) => {
		table.dropIndex("guid", "idx_decision_guid");
		table.dropIndex(["info_hash", "guid"], "idx_decision_info_hash_guid");
	});
}

export default { name: "11-trackers", up, down };
