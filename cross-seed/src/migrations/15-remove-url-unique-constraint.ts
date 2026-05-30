import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	// Drop the unique constraint on the url column
	await knex.schema.alterTable("indexer", (table) => {
		table.dropUnique(["url"]);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	// Re-add the unique constraint on the url column
	await knex.schema.alterTable("indexer", (table) => {
		table.unique(["url"]);
	});
}

export default { name: "15-remove-url-unique-constraint", up, down };
