import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("library_scan", (table) => {
		table.increments("id").primary();
		table.string("source").notNullable().index();
		table.string("source_instance").index();
		table.string("status").notNullable().index();
		table.integer("started_at").notNullable();
		table.integer("finished_at");
		table.string("error");
		table.integer("items_seen").notNullable().defaultTo(0);
		table.integer("items_upserted").notNullable().defaultTo(0);
		table.integer("items_removed").notNullable().defaultTo(0);
	});

	await knex.schema.createTable("library_item", (table) => {
		table.increments("id").primary();
		table.string("source").notNullable().index();
		table.string("source_instance").index();
		table.string("source_key").notNullable().unique();
		table.string("client_host").index();
		table.string("info_hash").index();
		table.string("path").index();
		table.string("name").notNullable();
		table.string("title").notNullable().index();
		table.json("files").notNullable();
		table.integer("length").notNullable();
		table.string("save_path");
		table.string("category");
		table.json("tags");
		table.json("trackers");
		table.string("content_fingerprint").index();
		table.integer("first_seen_at").notNullable();
		table.integer("last_seen_at").notNullable();
		table.integer("last_indexed_at").notNullable();
		table.integer("missing_since").index();
		table
			.integer("last_seen_scan_id")
			.references("id")
			.inTable("library_scan")
			.index();
		table.integer("updated_at").notNullable();
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("library_item");
	await knex.schema.dropTable("library_scan");
}

export default { name: "18-library-inventory", up, down };
