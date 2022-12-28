import Knex from "knex";
import { join } from "path";
import { appDir } from "../configuration.js";
import { getTorznabManager } from "../torznab.js";
async function up(knex: Knex.Knex): Promise<void> {
	const connection = await knex.client.acquireConnection();
	await connection.backup(
		join(appDir(), "cross-seed.pre-timestamps.backup.db")
	);
	await knex.client.releaseConnection(connection);

	await knex.schema.createTable("indexer", (table) => {
		table.increments("id").primary();
		table.string("url").unique();
		table.boolean("active");
	});

	await knex.schema.createTable("timestamp", (table) => {
		table.integer("searchee_id").references("id").inTable("searchee");
		table.integer("indexer_id").references("id").inTable("indexer");
		table.integer("first_searched");
		table.integer("last_searched");
		table.primary(["searchee_id", "indexer_id"]);
	});

	// this is a bit of a shortcut but since db migrations run once, a
	// little double-logging in an error case isn't too bad
	await getTorznabManager().validateTorznabUrls();

	await knex.transaction(async (trx) => {
		const timestampRows = await trx
			.select(
				"searchee.id as searchee_id",
				"indexer.id as indexer_id",
				"searchee.first_searched as first_searched",
				"searchee.last_searched as last_searched"
			)
			.from("searchee")
			.crossJoin(knex.raw("indexer"));
		await trx.batchInsert("timestamp", timestampRows, 100);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("timestamp");
	await knex.schema.dropTable("indexer");
}

export default { name: "02-timestamps", up, down };
