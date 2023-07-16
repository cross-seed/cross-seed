import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex("torrent").del();
	await knex.schema.alterTable("torrent", (table) => {
		table.integer("searchee_id").references("id").inTable("searchee");
		table.string("info_hash").unique();
		table.renameColumn("file_path", "guid");
	});

	await knex.schema.createTable("file", (table) => {
		table.integer("id").primary();
		table.integer("searchee_id").references("id").inTable("searchee");
		table.string("name");
		table.string("path");
		table.string("length");
	});

	await knex.schema.alterTable("searchee", (table) => {
		table.string("data_root");
	});
}

function down(): void {
	// no new tables created
}

export default { name: "03-rateLimits", up, down };
