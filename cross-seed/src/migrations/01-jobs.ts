import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.createTable("job_log", (table) => {
		table.increments("id").primary();
		table.string("name").unique();
		table.integer("last_run");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("job_log");
}

export default { name: "01-jobs", up, down };
