import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("library_file", (table) => {
		table.increments("id").primary();
		table.string("source").notNullable().index();
		table.string("source_instance").index();
		table.string("item_source_key").notNullable().index();
		table.string("path").notNullable();
		table.string("name").notNullable();
		table.integer("length").notNullable();
		table.integer("first_seen_at").notNullable();
		table.integer("last_seen_at").notNullable();
		table.integer("missing_since").index();
		table
			.integer("last_seen_scan_id")
			.references("id")
			.inTable("library_scan")
			.index();
		table.integer("updated_at").notNullable();
		table.unique(["item_source_key", "path"]);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("library_file");
}

export default { name: "19-library-files", up, down };
