import Knex from "knex";
import { db } from "../db.js";
import { getRuntimeConfig } from "../runtimeConfig.js";

function sanitizeUrl(url: string | URL): string {
	url = new URL(url);
	return url.origin + url.pathname;
}

function getApikey(url: string) {
	return new URL(url).searchParams.get("apikey");
}

async function backfill(knex: Knex.Knex) {
	const { torznab } = getRuntimeConfig();

	await db("indexer")
		.insert(
			torznab.map((url) => ({
				url: sanitizeUrl(url),
				apikey: getApikey(url),
				active: true,
			}))
		)
		.onConflict("url")
		.merge(["active", "apikey"]);

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

async function up(knex: Knex.Knex): Promise<void> {
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

	await backfill(knex);
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("timestamp");
	await knex.schema.dropTable("indexer");
}

export default { name: "02-timestamps", up, down };
