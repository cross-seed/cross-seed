import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("indexer", (table) => {
		table.string("name").after("id");
		table.boolean("music_search_cap").nullable().after("movie_search_cap");
		table.boolean("audio_search_cap").nullable().after("music_search_cap");
		table.boolean("book_search_cap").nullable().after("audio_search_cap");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	return knex.schema.table("indexer", function (table) {
		table.dropColumn("name");
		table.dropColumn("music_search_cap");
		table.dropColumn("audio_search_cap");
		table.dropColumn("book_search_cap");
	});
}

export default { name: "10-indexerNameAudioBookCaps", up, down };
