import Sqlite from "better-sqlite3";
import { readdir, stat, unlink } from "fs/promises";
import knex from "knex";
import ms from "ms";
import { join } from "path";
import { getClients } from "./clients/TorrentClient.js";
import { appDir } from "./configuration.js";
import { TORRENT_CACHE_FOLDER } from "./constants.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { migrations } from "./migrations/migrations.js";
import { cacheEnsembleTorrentEntry, snatchHistory } from "./torrent.js";
import {
	filterAsync,
	flatMapAsync,
	inBatches,
	Mutex,
	notExists,
	withMutex,
} from "./utils.js";
import { rawGuidInfoHashMap } from "./decide.js";

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
	await (async () => {
		if (!useClientTorrents) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Refreshing all client torrents",
		});
		const searchees = await flatMapAsync(
			getClients(),
			async (client) =>
				(await client.getClientSearchees({ refresh: [] })).searchees,
		);
		if (!seasonFromEpisodes) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Refreshing all ensemble torrents",
		});
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
	})();
	await (async () => {
		if (!dataDirs.length) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning deleted dataDirs entries",
		});
		const deletedPaths = await filterAsync(
			(await db("data").select("path")).map((e) => e.path),
			(p) => notExists(p),
		);
		await inBatches(deletedPaths, async (batch) => {
			await db("data").whereIn("path", batch).del();
			await db("ensemble").whereIn("path", batch).del();
		});
	})();
	await (async () => {
		if (!seasonFromEpisodes) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning deleted ensemble entries",
		});
		const deletedPaths = await filterAsync(
			(await db("ensemble").select("path")).map((e) => e.path),
			(p) => notExists(p),
		);
		await inBatches(deletedPaths, async (batch) => {
			await db("data").whereIn("path", batch).del();
			await db("ensemble").whereIn("path", batch).del();
		});
	})();
	await (async () => {
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning failed snatch history entries",
		});
		for (const [
			str,
			{ initialFailureAt, numFailures },
		] of snatchHistory.entries()) {
			if (Date.now() - initialFailureAt > ms("1 day")) {
				logger.verbose({
					label: Label.CLEANUP,
					message: `Deleting snatch history entry for ${str}: ${numFailures} failures`,
				});
				snatchHistory.delete(str);
			}
		}
	})();
	await (async () => {
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning old torrent cache entries",
		});
		const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
		const files = await readdir(torrentCacheDir);
		const now = Date.now();
		for (const file of files) {
			const filePath = join(torrentCacheDir, file);
			if (now - (await stat(filePath)).atimeMs > ms("1 year")) {
				logger.verbose({
					label: Label.CLEANUP,
					message: `Deleting torrent cache entry for ${filePath}`,
				});
				await db("decision")
					.where("info_hash", file.split(".")[0])
					.del();
				await unlink(filePath);
			}
		}
	})();
	await withMutex(
		Mutex.CREATE_GUID_INFO_HASH_MAP,
		{ useQueue: true },
		async () => {
			logger.verbose({
				label: Label.CLEANUP,
				message: "Rebuilding guidInfoHashMap",
			});
			const res = await db("decision")
				.select("guid", "info_hash")
				.whereNotNull("info_hash");
			rawGuidInfoHashMap.clear();
			for (const { guid, info_hash } of res) {
				rawGuidInfoHashMap.set(guid, info_hash);
			}
		},
	);
}
