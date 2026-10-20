import type { Knex } from "knex";

async function up(knex: Knex): Promise<void> {
	// Preserve alternate titles, episode mappings and all torrent-backed rows.
	await knex("ensemble")
		.whereNull("client_host")
		.whereNull("info_hash")
		.whereNotIn(
			"rowid",
			knex("ensemble")
				.min("rowid")
				.whereNull("client_host")
				.whereNull("info_hash")
				.groupBy("path", "ensemble", "element"),
		)
		.del();
	await knex.raw(`
		CREATE UNIQUE INDEX ensemble_data_mapping_unique
		ON ensemble(path, ensemble, element)
		WHERE client_host IS NULL AND info_hash IS NULL
	`);
}

async function down(knex: Knex): Promise<void> {
	await knex.raw("DROP INDEX IF EXISTS ensemble_data_mapping_unique");
}

export default { name: "18-unique-ensemble-data-mappings", up, down };
