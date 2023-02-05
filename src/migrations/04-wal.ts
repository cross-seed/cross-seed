import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	const connection = await knex.client.acquireConnection();
	await connection.pragma("journal_mode = WAL");
	await knex.client.releaseConnection(connection);
}

async function down(): Promise<void> {
	// the only way is forward
}

export default { name: "04-wal", up, down, config: { transaction: false } };
