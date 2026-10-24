import type { Knex } from "knex";
import type { EnsembleEntry } from "./torrent.js";
import { inBatches, yieldToEventLoop } from "./utils.js";

/** Replace a source file's complete alias set without overwriting other sources. */
export async function replaceEnsembleEntries(
	database: Knex,
	entries: EnsembleEntry[],
): Promise<void> {
	const sources = new Map<string, EnsembleEntry[]>();
	for (const entry of entries) {
		const key = JSON.stringify([
			entry.client_host,
			entry.path,
			entry.info_hash,
		]);
		const aliases = sources.get(key) ?? [];
		aliases.push(entry);
		sources.set(key, aliases);
	}
	await inBatches(
		[...sources.values()],
		async (groups) => {
			await database.transaction(async (trx) => {
				await trx("ensemble")
					.where((query) => {
						for (const [entry] of groups) {
							query.orWhere({
								client_host: entry.client_host,
								path: entry.path,
								info_hash: entry.info_hash,
							});
						}
					})
					.del();
				await inBatches(groups.flat(), async (batch) => {
					await trx("ensemble").insert(batch).onConflict().ignore();
				});
			});
			await yieldToEventLoop();
		},
		{ batchSize: 100 },
	);
}
