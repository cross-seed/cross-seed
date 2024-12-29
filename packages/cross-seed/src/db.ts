import { unlink } from "fs/promises";
import knex from "knex";
import BetterSqlite3Client from "knex/lib/dialects/better-sqlite3/index.js";
import ms from "ms";
import { DatabaseSync } from "node:sqlite";
import { basename, join } from "path";
import { getClients } from "./clients/TorrentClient.js";
import { appDir } from "./configuration.js";
import { TORRENT_CACHE_FOLDER } from "./constants.js";
import { getCachedTorrentName, rebuildGuidInfoHashMap } from "./decide.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { migrations } from "./migrations/migrations.js";
import { Metafile } from "./parseTorrent.js";
import {
	cacheEnsembleTorrentEntry,
	findAllTorrentFilesInDir,
	parseTorrentFromPath,
	snatchHistory,
} from "./torrent.js";
import {
	filterAsync,
	flatMapAsync,
	getLogString,
	humanReadableDate,
	inBatches,
	notExists,
	yieldToEventLoop,
} from "./utils.js";

export class NodeSqliteClient extends BetterSqlite3Client {
	_driver() {
		return DatabaseSync;
	}

	// Get a raw connection from the database, returning a promise with the connection object.
	async acquireRawConnection() {
		const connection = new this.driver(this.connectionSettings.filename);
		connection.exec("pragma journal_mode = WAL;");
		return connection;
	}

	// Used to explicitly close a connection, called internally by the pool when
	// a connection times out or the pool is shutdown.
	async destroyRawConnection(connection) {
		return connection.close();
	}

	// Runs the query on the specified connection, providing the bindings and any
	// other necessary prep work.
	async _query(connection, obj) {
		if (!obj.sql) throw new Error("The query is empty");

		if (!connection) {
			throw new Error("No connection provided");
		}

		const statement = connection.prepare(obj.sql);
		const bindings = this._formatBindings(obj.bindings);

		// hack - if we use an INSERT…RETURNING statement it won't work
		if (obj.sql.toLowerCase().startsWith("select")) {
			obj.response = await statement.all(...bindings);
			return obj;
		}

		const response = await statement.run(...bindings);
		obj.response = response;
		obj.context = {
			lastID: response.lastInsertRowid,
			changes: response.changes,
		};

		return obj;
	}
}
// @ts-expect-error set the driver name
NodeSqliteClient.prototype.driverName = "node:sqlite";

const filename = join(appDir(), "cross-seed.db");

export const db = knex({
	client: NodeSqliteClient,
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});

export async function cleanupDB(): Promise<void> {
	const {
		dataDirs,
		excludeRecentSearch,
		seasonFromEpisodes,
		useClientTorrents,
	} = getRuntimeConfig();
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
			message: "Pruning unused torrent cache entries...",
		});
		const excludeCutoff = (excludeRecentSearch ?? 0) + ms("1 month");
		let cutoffMs = ms("1 year");
		let logCutoff = "1 year";
		if (excludeCutoff > cutoffMs) {
			cutoffMs = excludeCutoff;
			logCutoff = `your excludeRecentSearch of ${(excludeRecentSearch! / 1000 / 60 / 60 / 24).toFixed(2)} days`;
		}
		const torrentPaths = await findAllTorrentFilesInDir(
			join(appDir(), TORRENT_CACHE_FOLDER),
		);
		if (!torrentPaths.length) return;
		const infoHashLastSeenMap = (
			await db("decision").select("info_hash", "last_seen")
		).reduce<Map<string, number>>((acc, cur) => {
			if (!cur.info_hash || !cur.last_seen) return acc;
			if (!acc.has(cur.info_hash)) {
				acc.set(cur.info_hash, cur.last_seen);
			} else if (cur.last_seen > acc.get(cur.info_hash)!) {
				acc.set(cur.info_hash, cur.last_seen);
			}
			return acc;
		}, new Map<string, number>());
		if (!infoHashLastSeenMap.size) return;
		const hashesToDelete: string[] = [];
		const now = Date.now();
		for (const [index, torrentPath] of torrentPaths.entries()) {
			if (index % 1000 === 0) await yieldToEventLoop();
			const infoHash = basename(torrentPath).split(".")[0];
			const lastSeen = infoHashLastSeenMap.get(infoHash);
			if (lastSeen && now - lastSeen <= cutoffMs) continue;
			let meta: Metafile | null = null;
			try {
				meta = await parseTorrentFromPath(torrentPath);
			} catch (e) {
				logger.error({
					label: Label.CLEANUP,
					message: `Failed to parse ${torrentPath} when cleaning up unused torrents: ${e.message}`,
				});
				logger.debug(e);
			}
			const logEntry = meta
				? `${getLogString(meta)} (${torrentPath})`
				: torrentPath;
			logger.verbose({
				label: Label.CLEANUP,
				message: `Deleting unused torrent cache entry for ${logEntry} - it has not been accessed in over ${logCutoff} - ${humanReadableDate(lastSeen ?? 0)}`,
			});
			try {
				await unlink(torrentPath);
				hashesToDelete.push(infoHash); // Pruning invalid decision entries will catch any interruptions or race conditions
			} catch (e) {
				logger.error({
					label: Label.CLEANUP,
					message: `Failed to delete ${torrentPath} when cleaning up unused torrents: ${e.message}`,
				});
				logger.debug(e);
			}
		}
		await inBatches(hashesToDelete, async (batch) => {
			await db("decision").whereIn("info_hash", batch).del();
		});
	})();
	await (async () => {
		logger.verbose({
			label: Label.CLEANUP,
			message: "Pruning invalid decision entries...",
		});
		await db("decision").whereNull("info_hash").del();
		const dbRows: { name: string | null; info_hash: string | null }[] =
			await db("decision")
				.leftJoin("searchee", "decision.searchee_id", "searchee.id")
				.select("searchee.name", "decision.info_hash");
		if (!dbRows.length) return;
		const torrentCacheDir = join(appDir(), TORRENT_CACHE_FOLDER);
		const torrentPaths = new Set(
			await findAllTorrentFilesInDir(torrentCacheDir),
		);
		if (!torrentPaths.size) return;
		let validRows = 0;
		const hashesToDelete = new Set<string>();
		for (const dbRow of dbRows) {
			if (validRows % 1000 === 0) await yieldToEventLoop();
			if (!dbRow.info_hash) continue;
			validRows++;
			const torrentPath = join(
				torrentCacheDir,
				getCachedTorrentName(dbRow.info_hash),
			);
			if (torrentPaths.has(torrentPath)) continue;
			logger.verbose({
				label: Label.CLEANUP,
				message: `Deleting invalid decision entries for ${dbRow.info_hash} (related to ${dbRow.name}) - missing .torrent file in cache`,
			});
			hashesToDelete.add(dbRow.info_hash);
		}
		if (validRows && hashesToDelete.size === validRows) {
			logger.verbose({
				label: Label.CLEANUP,
				message:
					"All decision entries are invalid - skipping deletion to avoid catastrophic data loss",
			});
			return;
		}
		await inBatches(Array.from(hashesToDelete), async (batch) => {
			await db("decision").whereIn("info_hash", batch).del();
		});
	})();
	await (async () => {
		logger.verbose({
			label: Label.CLEANUP,
			message: "Rebuilding guid infoHash map...",
		});
		await rebuildGuidInfoHashMap();
	})();
}
