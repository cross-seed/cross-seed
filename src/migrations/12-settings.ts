import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("settings", (table) => {
		table.json("settings_json");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("settings", (table) => {
		table.dropColumn("settings_json");
	});
}

export default { name: "12-settings", up, down };
