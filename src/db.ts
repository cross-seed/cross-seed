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
import {
	cacheEnsembleTorrentEntry,
	parseMetadataFromFilename,
	snatchHistory,
} from "./torrent.js";
import {
	filterAsync,
	flatMapAsync,
	inBatches,
	Mutex,
	notExists,
	withMutex,
	yieldToEventLoop,
} from "./utils.js";
import { existsInTorrentCache, rawGuidInfoHashMap } from "./decide.js";

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

export async function cleanupDB(options?: { runAll: boolean }): Promise<void> {
	const { dataDirs, seasonFromEpisodes, useClientTorrents } =
		getRuntimeConfig();
	await (async () => {
		if (!useClientTorrents) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Refreshing all client torrents...",
		});
		const searchees = await flatMapAsync(
			getClients(),
			async (client) =>
				(
					await client.getClientSearchees({
						refresh: [],
						includeFiles: true,
						includeTrackers: true,
					})
				).searchees,
		);
		if (!seasonFromEpisodes) return;
		logger.verbose({
			label: Label.CLEANUP,
			message: "Refreshing all ensemble torrents...",
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
			message: "Pruning deleted dataDirs entries...",
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
			message: "Pruning deleted ensemble entries...",
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
			message: "Pruning failed snatch history entries...",
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
			message: "Pruning old torrent cache entries...",
		});
		const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
		const dirEntries = await readdir(torrentCacheDir);
		const now = Date.now();
		for (const file of dirEntries) {
			const filePath = join(torrentCacheDir, file);
			if (now - (await stat(filePath)).atimeMs > ms("1 year")) {
				logger.verbose({
					label: Label.CLEANUP,
					message: `Deleting torrent cache entry for ${filePath}`,
				});
				let { infoHash } = parseMetadataFromFilename(file);
				if (!infoHash) infoHash = file.split(".")[0];
				await db("decision").where("info_hash", infoHash).del();
				await unlink(filePath);
			}
		}
	})();
	await (async () => {
		if (!options?.runAll) {
			const run_percentage = 0.03; // Roughly once a month if cleanupDB() is called daily. Override with /api/job.
			if (Math.random() > run_percentage) {
				logger.verbose({
					label: Label.CLEANUP,
					message: `Skipping pruning of invalid decision entries, will run roughly once per month`,
				});
				return; // This should rarely be needed, and likely only a few entries. It's slow with with lots of I/O.
			}
		}
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning invalid decision entries...",
		});
		await db("decision").whereNull("info_hash").del();
		const dbRows: { name: string | null; info_hash: string | null }[] =
			await db("decision")
				.leftJoin("searchee", "decision.searchee_id", "searchee.id")
				.select("searchee.name", "decision.info_hash");
		const invalidInfoHashes = new Set<string>();
		const dirEntries = await readdir(join(appDir(), TORRENT_CACHE_FOLDER));
		for (const dbRow of dbRows) {
			if (!dbRow.info_hash) continue;
			if (await existsInTorrentCache(dbRow.info_hash, dirEntries)) {
				continue;
			}
			logger.verbose({
				label: Label.CLEANUP,
				message: `Deleting invalid decision entries for ${dbRow.info_hash} (related to ${dbRow.name}) - missing .torrent file in cache`,
			});
			invalidInfoHashes.add(dbRow.info_hash);
			await yieldToEventLoop();
		}
		await inBatches(Array.from(invalidInfoHashes), async (batch) => {
			await db("decision").whereIn("info_hash", batch).del();
		});
	})();
	await withMutex(
		Mutex.CREATE_GUID_INFO_HASH_MAP,
		{ useQueue: true },
		async () => {
			logger.verbose({
				label: Label.CLEANUP,
				message: "Rebuilding guidInfoHashMap...",
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
