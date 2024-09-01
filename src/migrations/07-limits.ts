import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.json("limits_caps");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	return knex.schema.table("indexer", function (table) {
		table.dropColumn("limits_caps");
	});
}

export default { name: "07-limits", up, down };
