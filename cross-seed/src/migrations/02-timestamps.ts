import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("indexer", (table) => {
		table.increments("id").primary();
		table.string("url").unique();
		table.string("apikey");
		table.boolean("active");
	});

	await knex.schema.createTable("timestamp", (table) => {
		table.integer("searchee_id").references("id").inTable("searchee");
		table.integer("indexer_id").references("id").inTable("indexer");
		table.integer("first_searched");
		table.integer("last_searched");
		table.primary(["searchee_id", "indexer_id"]);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("timestamp");
	await knex.schema.dropTable("indexer");
}

export default { name: "02-timestamps", up, down };
