import type { Knex } from "knex";
import type { EnsembleEntry } from "./torrent.js";

export type EnsembleDataEntry = EnsembleEntry & {
	client_host: null;
	info_hash: null;
};

/** Cache each dataDirs mapping without discarding other titles or sources. */
export async function cacheEnsembleDataEntries(
	database: Knex,
	entries: EnsembleDataEntry[],
): Promise<void> {
	for (let i = 0; i < entries.length; i += 100) {
		const batch = entries.slice(i, i + 100);
		await database.transaction(async (trx) => {
			for (const row of batch) {
				const existing = await trx("ensemble")
					.select("rowid")
					.whereNull("client_host")
					.whereNull("info_hash")
					.where({
						path: row.path,
						ensemble: row.ensemble,
						element: row.element,
					})
					.first();
				// Leave historical duplicates for cleanup so it also vacuums.
				if (!existing) await trx("ensemble").insert(row);
			}
		});
	}
}

/** Remove historical dataDirs duplicates, then reclaim their disk space. */
export async function cleanupDuplicateEnsembleDataEntries(
	database: Knex,
): Promise<number> {
	let removed = 0;
	let deleted: number;
	do {
		// Bound each write transaction and keep one copy of every mapping.
		deleted = await database("ensemble")
			.whereIn(
				"rowid",
				database("ensemble as duplicate")
					.select("duplicate.rowid")
					.whereNull("duplicate.client_host")
					.whereNull("duplicate.info_hash")
					.whereExists(
						database("ensemble as original")
							.select(database.raw("1"))
							.whereNull("original.client_host")
							.whereNull("original.info_hash")
							.whereRaw("original.path IS duplicate.path")
							.whereRaw("original.ensemble IS duplicate.ensemble")
							.whereRaw("original.element IS duplicate.element")
							.whereRaw("original.rowid < duplicate.rowid"),
					)
					.limit(10000),
			)
			.del();
		removed += deleted;
	} while (deleted);
	// VACUUM must run after the deletion transactions have committed.
	if (removed) await database.raw("VACUUM");
	return removed;
}
