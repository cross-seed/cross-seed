import Knex from "knex";
import db from "../db.js";

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

	if (
		db.data.indexedTorrents.length > 0 ||
		Object.keys(db.data.decisions).length > 0 ||
		Object.keys(db.data.searchees).length > 0
	)
		await knex.transaction(async (trx) => {
			await trx.batchInsert(
				"searchee",
				Object.entries(db.data.searchees).map(
					([name, { firstSearched, lastSearched }]) => ({
						name,
						first_searched: firstSearched,
						last_searched: lastSearched,
					})
				)
			);

			const dbSearchees = await trx.select("*").from("searchee");
			const normalizedDecisions = Object.entries(db.data.decisions)
				.map(([searcheeName, results]) => {
					return Object.entries(results).map(
						([
							guid,
							{ decision, lastSeen, firstSeen, infoHash },
						]) => {
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
			await trx.batchInsert("decision", normalizedDecisions);
			await trx.batchInsert(
				"torrent",
				db.data.indexedTorrents.map((e) => ({
					info_hash: e.infoHash,
					name: e.name,
					file_path: e.filepath,
				}))
			);
		});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("searchee");
	await knex.schema.dropTable("decision");
	await knex.schema.dropTable("torrent");
}

export default { name: "00-initialSchema", up, down };
