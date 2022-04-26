import Knex from "knex";
import { getCacheFileData, renameCacheFile } from "../cache.js";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("searchee", (table) => {
		table.increments("id").primary();
		table.string("name").unique();
		table.integer("first_searched");
		table.integer("last_searched");
	});
	await knex.schema.createTable("decision", (table) => {
		table.increments("id").primary();
		table.integer("searchee_id").references("id").inTable("searchee");
		table.string("guid").unique();
		table.string("info_hash");
		table.string("decision");
		table.integer("first_seen");
		table.integer("last_seen");
	});
	await knex.schema.createTable("torrent", (table) => {
		table.increments("id").primary();
		table.string("info_hash");
		table.string("name");
		table.string("file_path");
	});

	const cacheData = await getCacheFileData();
	if (!cacheData) return;

	await knex.transaction(async (trx) => {
		const chunkSize = 100;
		const searcheeRows = Object.entries(cacheData.searchees).map(
			([name, { firstSearched, lastSearched }]) => ({
				name,
				first_searched: firstSearched,
				last_searched: lastSearched,
			})
		);
		await trx.batchInsert("searchee", searcheeRows, chunkSize);

		const dbSearchees = await trx.select("*").from("searchee");
		const normalizedDecisions = Object.entries(cacheData.decisions)
			.map(([searcheeName, results]) => {
				return Object.entries(results).map(
					([guid, { decision, lastSeen, firstSeen, infoHash }]) => {
						return {
							searchee_id: dbSearchees.find(
								(searchee) => searchee.name === searcheeName
							).id,
							guid,
							decision,
							last_seen: lastSeen,
							first_seen: firstSeen,
							info_hash: infoHash,
						};
					}
				);
			})
			.flat();
		const torrentRows = cacheData.indexedTorrents.map((e) => ({
			info_hash: e.infoHash,
			name: e.name,
			file_path: e.filepath,
		}));
		await trx.batchInsert("decision", normalizedDecisions, chunkSize);
		await trx.batchInsert("torrent", torrentRows, chunkSize);
	});
	await renameCacheFile();
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("searchee");
	await knex.schema.dropTable("decision");
	await knex.schema.dropTable("torrent");
}

export default { name: "00-initialSchema", up, down };
