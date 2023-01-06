import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.string("apikey");
		table.string("status");
		table.integer("status_updated_at");
		table.boolean("search_cap");
		table.boolean("tv_search_cap");
		table.boolean("movie_search_cap");
	});
}

function down(): void {
	// no new tables created
}

export default {
	name: "03-rateLimits",
	up,
	down,
	config: { transaction: true },
};
