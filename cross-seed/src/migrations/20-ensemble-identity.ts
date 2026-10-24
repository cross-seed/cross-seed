import type { Knex } from "knex";
import { setImmediate } from "node:timers/promises";

/**
 * Ensemble rows are derived cache entries. Preserve all distinct aliases and
 * sources, removing only identical tuples. The old nullable composite primary
 * key neither deduplicated file sources nor retained aliases for client sources.
 * Copy by rowid in bounded batches: no all-rows JS array, global sort, or VACUUM.
 * Knex wraps this migration in a transaction, so interruption rolls it back.
 */
async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("ensemble_next", (table) => {
		table.string("client_host");
		table.string("path");
		table.string("info_hash");
		table.string("ensemble");
		table.string("element");
	});
	// Include the null flag as well as the value to distinguish null from "".
	const identity = ["client_host", "path", "info_hash", "ensemble", "element"]
		.flatMap((column) => [`(${column} IS NULL)`, `COALESCE(${column}, '')`])
		.join(", ");
	await knex.raw(
		`CREATE UNIQUE INDEX ensemble_identity ON ensemble_next (${identity})`,
	);
	await knex.schema.alterTable("ensemble_next", (table) => {
		table.index("path", "ensemble_next_path_index");
		table.index("info_hash", "ensemble_next_info_hash_index");
		table.index("ensemble", "ensemble_key_index");
	});
	let cursor: number | undefined;
	for (;;) {
		const page = knex<{ rowid: number }>("ensemble")
			.select("rowid")
			.orderBy("rowid")
			.limit(1000);
		if (cursor !== undefined) page.where("rowid", ">", cursor);
		const rows = await page;
		if (!rows.length) break;
		const last = rows[rows.length - 1].rowid;
		await knex.raw(
			`INSERT OR IGNORE INTO ensemble_next (client_host, path, info_hash, ensemble, element)
   SELECT client_host, path, info_hash, ensemble, element FROM ensemble
   WHERE rowid >= ? AND rowid <= ?`,
			[rows[0].rowid, last],
		);
		cursor = last;
		await setImmediate();
	}
	await knex.schema.dropTable("ensemble");
	await knex.schema.renameTable("ensemble_next", "ensemble");
}

// eslint-disable-next-line @typescript-eslint/require-await
async function down(): Promise<void> {
	// The previous key cannot represent distinct aliases of the same client file.
	// Refuse a lossy rollback; restore the pre-upgrade backup instead.
	throw new Error(
		"Cannot roll back ensemble identity safely. Restore a pre-upgrade database backup.",
	);
}

export default { name: "20-ensemble-identity", up, down };
