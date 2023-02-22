import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.string("status");
		table.integer("retry_after");
		table.boolean("search_cap").nullable();
		table.boolean("tv_search_cap").nullable();
		table.boolean("movie_search_cap").nullable();
	});
}

function down(): void {
	// no new tables created
}

export default { name: "03-rateLimits", up, down };
