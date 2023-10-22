import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("settings", (table) => {
		table.integer("id").primary();
		table.check("id = 0");
		table.string("apikey");
	});
	await knex("settings").insert({ id: 0 });
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("settings");
}

export default { name: "04-auth", up, down };
