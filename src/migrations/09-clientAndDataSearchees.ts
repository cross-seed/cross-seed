import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("client_searchees", (table) => {
		table.string("client_host");
		table.string("info_hash").index();
		table.primary(["client_host", "info_hash"]);
		table.string("name");
		table.string("title");
		table.json("files");
		table.integer("length");
		table.string("save_path");
		table.string("category");
		table.json("tags");
		table.json("trackers");
	});

	await knex.schema.createTable("data", (table) => {
		table.string("path").primary();
		table.string("title");
	});

	await knex.schema.createTable("ensemble", (table) => {
		table.string("client_host");
		table.string("path").index();
		table.primary(["client_host", "path"]);
		table.string("info_hash").index();
		table.string("ensemble");
		table.string("element");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	knex.schema.dropTable("client_searchees");
	knex.schema.dropTable("data");
	knex.schema.dropTable("ensemble");
}

export default { name: "09-clientAndDataSearchees", up, down };
