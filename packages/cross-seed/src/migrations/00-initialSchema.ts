import Knex from "knex";

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
		table.string("guid");
		table.string("info_hash");
		table.string("decision");
		table.integer("first_seen");
		table.integer("last_seen");
	});
	await knex.schema.createTable("torrent", (table) => {
		table.increments("id").primary();
		table.string("info_hash");
		table.string("name");
		table.string("file_path").unique();
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("searchee");
	await knex.schema.dropTable("decision");
	await knex.schema.dropTable("torrent");
}

export default { name: "00-initialSchema", up, down };
