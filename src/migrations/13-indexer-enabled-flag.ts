import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.boolean("enabled");
	});
	await knex("indexer").update({ enabled: true });
	await knex.schema.alterTable("indexer", (table) => {
		table.boolean("enabled").notNullable().alter();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.dropColumn("enabled");
	});
}

export default { name: "13-indexer-enabled-flag", up, down };
