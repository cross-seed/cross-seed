import knex from "knex";

export async function up(knex: knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.boolean("enabled").notNullable().defaultTo(true);
	});
}

export async function down(knex: knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.dropColumn("enabled");
	});
}

export default { name: "13-indexer-enabled-flag", up, down };
