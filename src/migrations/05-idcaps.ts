import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.text("tv_id_caps");
		table.text("movie_id_caps");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	return knex.schema.table("indexer", function (table) {
		table.dropColumn("tv_id_caps");
		table.dropColumn("movie_id_caps");
	});
}
export default { name: "05-idcaps", up, down };
