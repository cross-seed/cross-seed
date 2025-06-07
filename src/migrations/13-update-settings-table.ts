import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	// Add new columns to the settings table
	await knex.schema.alterTable("settings", (table) => {
		table.string("version").notNullable().defaultTo("1.0.0");
		table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
		table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
	});

	// Add performance indices for settings queries
	await knex.schema.alterTable("settings", (table) => {
		table.index("settings", "idx_settings");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("settings", (table) => {
		table.dropIndex("settings", "idx_settings");
	});

	await knex.schema.alterTable("settings", (table) => {
		table.dropColumn("version");
		table.dropColumn("created_at");
		table.dropColumn("updated_at");
	});
}

export default { name: "13-update-settings-table", up, down };
