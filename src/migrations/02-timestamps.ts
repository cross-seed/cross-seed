import Knex from "knex";
import { join } from "path";
import { appDir } from "../configuration.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { uniq } from "lodash-es";
async function up(knex: Knex.Knex): Promise<void> {
	const connection = await knex.client.acquireConnection();
	await connection.backup(
		join(appDir(), "cross-seed.pre-timestamps.backup.db")
	);
	await knex.client.releaseConnection(connection);

	await knex.schema.createTable("indexer", (table) => {
		table.increments("id").primary();
		table.string("url").unique();
	});

	await knex.schema.createTable("timestamp", (table) => {
		table.integer("searchee_id").references("id").inTable("searchee");
		table.integer("indexer_id").references("id").inTable("indexer");
		table.integer("first_searched");
		table.integer("last_searched");
		table.primary(["searchee_id", "indexer_id"]);
	});

	const chunkSize = 100;
	const { torznab } = getRuntimeConfig();
	const torznabUniques: typeof torznab = uniq(torznab);
	const indexerRows = torznabUniques.map((url) => ({ url }));
	await knex.batchInsert("indexer", indexerRows, chunkSize);

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
		await trx.batchInsert("timestamp", timestampRows, chunkSize);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("timestamp");
	await knex.schema.dropTable("indexer");
}

export default { name: "02-timestamps", up, down };
