import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("rss", (table) => {
		table
			.integer("indexer_id")
			.references("id")
			.inTable("indexer")
			.primary();
		table.string("last_seen_guid");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	return knex.schema.dropTable("rss");
}

export default { name: "08-rss", up, down };
