import type { Knex } from "knex";
import type { EnsembleEntry } from "./torrent.js";

export type EnsembleDataEntry = EnsembleEntry & {
	client_host: null;
	info_hash: null;
};

export async function cacheEnsembleDataEntries(
	database: Knex,
	entries: EnsembleDataEntry[],
): Promise<void> {
	for (let i = 0; i < entries.length; i += 100) {
		await database("ensemble")
			.insert(entries.slice(i, i + 100))
			.onConflict(
				database.raw(
					"(path, ensemble, element) WHERE client_host IS NULL AND info_hash IS NULL",
				),
			)
			.merge();
	}
}
