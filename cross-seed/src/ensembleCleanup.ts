import { access } from "node:fs/promises";
import type { Knex } from "knex";
import { filterAsync, inBatches, yieldToEventLoop } from "./utils.js";

async function confirmedMissing(path: string): Promise<boolean> {
	try {
		await access(path);
		return false;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// Unreachable mounts and permission failures are not proof of deletion.
		return code === "ENOENT" || code === "ENOTDIR";
	}
}

/** Indexed keyset pagination bounds memory and concurrent filesystem requests. */
export async function pruneMissingFileEntries(
	database: Knex,
	table: "data" | "ensemble",
	missing: (path: string) => Promise<boolean> = confirmedMissing,
): Promise<void> {
	let cursor: string | undefined;
	for (;;) {
		const page = database<{ path: string }>(table)
			.distinct("path")
			.whereNotNull("path")
			.orderBy("path")
			.limit(256);
		if (cursor !== undefined) page.where("path", ">", cursor);
		const rows = await page;
		if (!rows.length) return;
		cursor = rows[rows.length - 1].path;
		await inBatches(
			rows.map((row) => row.path),
			async (paths) => {
				const deleted = await filterAsync(paths, missing);
				if (deleted.length) {
					await database("data").whereIn("path", deleted).del();
					// A path can have many legitimate source/alias entries. Bound each delete.
					let count: number;
					do {
						count = await database("ensemble")
							.whereIn(
								"rowid",
								database("ensemble")
									.select("rowid")
									.whereIn("path", deleted)
									.limit(500),
							)
							.del();
						await yieldToEventLoop();
					} while (count === 500);
				}
				await yieldToEventLoop();
			},
			{ batchSize: 16 },
		);
	}
}
