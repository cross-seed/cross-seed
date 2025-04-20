import Sqlite from "better-sqlite3";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
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
import { inBatches, isTruthy } from "./utils.js";

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
			const searchees = (
				await Promise.all(
					getClients().map((client) =>
						client.getClientSearchees({
							refresh: [],
						}),
					),
				)
			)
				.map((r) => r.searchees)
				.flat();
			if (!seasonFromEpisodes) return;
			const ensembleRows = (
				await Promise.all(
					searchees.map((searchee) =>
						cacheEnsembleTorrentEntry(searchee),
					),
				)
			)
				.flat()
				.filter(isTruthy);
			await inBatches(ensembleRows, async (batch) => {
				await db("ensemble")
					.insert(batch)
					.onConflict(["client_host", "path"])
					.merge();
			});
		})(),
		(async () => {
			if (!dataDirs.length) return;
			const deletedPaths = (await db("data").select("path"))
				.map((e) => e.path)
				.filter((p) => !existsSync(p));
			await inBatches(deletedPaths, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble").whereIn("path", batch).del();
			});
		})(),
		(async () => {
			if (!seasonFromEpisodes) return;
			const deletedPaths = (await db("ensemble").select("path"))
				.map((e) => e.path)
				.filter((p) => !existsSync(p));
			await inBatches(deletedPaths, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble").whereIn("path", batch).del();
			});
		})(),
		(async () => {
			const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
			const files = readdirSync(torrentCacheDir);
			const now = Date.now();
			for (const file of files) {
				const filePath = join(torrentCacheDir, file);
				if (now - statSync(filePath).atimeMs > ms("1 year")) {
					logger.verbose(`Deleting ${filePath}`);
					await db("decision")
						.where("info_hash", file.split(".")[0])
						.del();
					unlinkSync(filePath);
				}
			}
		})(),
	]);
}
