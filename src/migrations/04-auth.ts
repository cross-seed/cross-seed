import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("settings", (table) => {
		table.integer("id").primary();
		table.check("id = 0");
		table.string("apikey");
	});
}

function down(): void {
	// no new tables created
}

export default { name: "04-auth", up, down };
