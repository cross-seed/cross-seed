import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex("torrent").del();
	await knex.schema.alterTable("torrent", (table) => {
		table.integer("searchee_id").references("id").inTable("searchee");
		table.unique(["info_hash"]);
		table.dropColumn("file_path");
	});

	await knex.schema.createTable("file", (table) => {
		table.integer("id").primary();
		table.integer("searchee_id").references("id").inTable("searchee");
		table.string("name");
		table.string("path");
		table.integer("length");
		table.unique(["searchee_id", "path"]);
	});

	await knex.schema.alterTable("searchee", (table) => {
		table.string("data_root");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("file");
}

export default { name: "04-files", up, down };
