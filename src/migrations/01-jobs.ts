import Knex from "knex";
import { join } from "path";
import { appDir } from "../configuration.js";

async function up(knex: Knex.Knex): Promise<void> {
	const connection = await knex.client.acquireConnection();
	await connection.backup(join(appDir(), "cross-seed.pre-jobs.backup.db"));
	await knex.client.releaseConnection(connection);

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
