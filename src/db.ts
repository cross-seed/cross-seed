import Sqlite from "better-sqlite3";
import { readdir, stat, unlink } from "fs/promises";
import knex from "knex";
import ms from "ms";
import { join } from "path";
import { getClients } from "./clients/TorrentClient.js";
import { appDir } from "./configuration.js";
import { TORRENT_CACHE_FOLDER } from "./constants.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { migrations } from "./migrations/migrations.js";
import { cacheEnsembleTorrentEntry } from "./torrent.js";
import { filterAsync, flatMapAsync, inBatches, notExists } from "./utils.js";

const filename = join(appDir(), "cross-seed.db");
const rawSqliteHandle = new Sqlite(filename);
rawSqliteHandle.pragma("journal_mode = WAL");
rawSqliteHandle.close();

export const db = knex({
	client: "better-sqlite3",
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});

export async function cleanupDB(): Promise<void> {
	const { dataDirs, seasonFromEpisodes, useClientTorrents } =
		getRuntimeConfig();
	await Promise.all([
		(async () => {
			if (!useClientTorrents) return;
			const searchees = await flatMapAsync(
				getClients(),
				async (client) =>
					(await client.getClientSearchees({ refresh: [] }))
						.searchees,
			);
			if (!seasonFromEpisodes) return;
			const ensembleRows = await flatMapAsync(
				searchees,
				async (searchee) =>
					(await cacheEnsembleTorrentEntry(searchee)) ?? [],
			);
			await inBatches(ensembleRows, async (batch) => {
				await db("ensemble")
					.insert(batch)
					.onConflict(["client_host", "path"])
					.merge();
			});
		})(),
		(async () => {
			if (!dataDirs.length) return;
			const deletedPaths = await filterAsync(
				(await db("data").select("path")).map((e) => e.path),
				(p) => notExists(p),
			);
			await inBatches(deletedPaths, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble").whereIn("path", batch).del();
			});
		})(),
		(async () => {
			if (!seasonFromEpisodes) return;
			const deletedPaths = await filterAsync(
				(await db("ensemble").select("path")).map((e) => e.path),
				(p) => notExists(p),
			);
			await inBatches(deletedPaths, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble").whereIn("path", batch).del();
			});
		})(),
		(async () => {
			const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
			const files = await readdir(torrentCacheDir);
			const now = Date.now();
			for (const file of files) {
				const filePath = join(torrentCacheDir, file);
				if (now - (await stat(filePath)).atimeMs > ms("1 year")) {
					logger.verbose(`Deleting ${filePath}`);
					await db("decision")
						.where("info_hash", file.split(".")[0])
						.del();
					await unlink(filePath);
				}
			}
		})(),
	]);
}
