/* global fetch */
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";
// Local, synthetic-only scale check. No existing database is opened.
// npm -w cross-seed run build
// ENSEMBLE_BENCHMARK_ROWS=1000000 node scripts/benchmark-ensemble.mjs
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import knex from "knex";

const rows = Number(process.env.ENSEMBLE_BENCHMARK_ROWS ?? 200000);
if (!Number.isSafeInteger(rows) || rows < 1000 || rows > 2000000) {
	throw new Error("Choose 1000..2000000 synthetic rows");
}
const dir = await mkdtemp(join(tmpdir(), "ensemble-benchmark-"));
process.env.CONFIG_DIR = dir;
const { NodeSqliteClient } = await import("../cross-seed/dist/db.js");
const { default: oldSchema } =
	await import("../cross-seed/dist/migrations/09-clientAndDataSearchees.js");
const { default: migration } =
	await import("../cross-seed/dist/migrations/20-ensemble-identity.js");
const { pruneMissingFileEntries } =
	await import("../cross-seed/dist/ensembleCleanup.js");
const filename = join(dir, "benchmark.db");
const database = knex({
	client: NodeSqliteClient,
	connection: { filename },
	useNullAsDefault: true,
});
let server;
try {
	await oldSchema.up(database);
	await database.schema.createTable("health", (table) =>
		table.integer("id").primary(),
	);
	await database("health").insert({ id: 1 });
	const raw = new DatabaseSync(filename);
	const uniquePaths = Math.floor(rows / 8);
	const insert = raw.prepare(
		"INSERT INTO ensemble VALUES (NULL, ?, NULL, ?, '1')",
	);
	raw.exec("BEGIN");
	for (let i = 0; i < rows; i++) {
		// Four copies of each of two legitimate aliases per path.
		insert.run(
			join(dir, "files", String(i % uniquePaths)),
			`show-${Math.floor(i / uniquePaths) % 2}`,
		);
	}
	raw.exec("COMMIT");
	raw.close();
	const sizes = async () => {
		const result = {};
		for (const suffix of ["", "-wal", "-shm"]) {
			result[suffix || "database"] = await stat(filename + suffix).then(
				(s) => s.size,
				() => 0,
			);
		}
		return result;
	};
	server = createServer((req, res) => {
		const respond = () => {
			res.end("ok");
		};
		if (req.url === "/db")
			void database("health")
				.first()
				.then(respond, (error) => {
					res.statusCode = 500;
					res.end(String(error));
				});
		else respond();
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const url = `http://127.0.0.1:${server.address().port}`;
	async function measure(operation, endpoint) {
		const latencies = [];
		let running = true;
		const beforeRss = process.memoryUsage().rss;
		let peakRss = beforeRss;
		let peakDisk = 0;
		const monitor = (async () => {
			while (running) {
				const start = performance.now();
				const response = await fetch(url + endpoint);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				await response.text();
				latencies.push(performance.now() - start);
				peakRss = Math.max(peakRss, process.memoryUsage().rss);
				const disk = await sizes();
				peakDisk = Math.max(
					peakDisk,
					Object.values(disk).reduce((sum, bytes) => sum + bytes, 0),
				);
				await setTimeout(2);
			}
		})();
		const start = performance.now();
		try {
			await operation();
		} finally {
			running = false;
			await monitor;
		}
		latencies.sort((a, b) => a - b);
		return {
			elapsedMs: performance.now() - start,
			requests: latencies.length,
			p95HttpMs: latencies[Math.floor(latencies.length * 0.95)],
			maxHttpMs: Math.max(...latencies),
			peakRssMiB: peakRss / 2 ** 20,
			rssGrowthMiB: (peakRss - beforeRss) / 2 ** 20,
			peakDatabaseAndWalMiB: peakDisk / 2 ** 20,
		};
	}
	const before = await sizes();
	// Startup migration owns the SQLite transaction; /health measures event-loop
	// responsiveness, not concurrent DB availability. The real app starts later.
	const upgrade = await measure(
		() => database.transaction((trx) => migration.up(trx)),
		"/health",
	);
	const afterRows = Number(
		(await database("ensemble").count({ count: "*" }).first()).count,
	);
	if (afterRows !== uniquePaths * 2)
		throw new Error(`Lost aliases: ${afterRows}`);
	const afterMigration = await sizes();
	// Actual stat calls to nonexistent paths, and DB-backed HTTP requests.
	// This is local filesystem evidence, not a reproduction of production NFS.
	const cleanup = await measure(
		() => pruneMissingFileEntries(database, "ensemble"),
		"/db",
	);
	const remaining = Number(
		(await database("ensemble").count({ count: "*" }).first()).count,
	);
	if (remaining !== 0) throw new Error(`Cleanup left ${remaining} rows`);
	console.log(
		JSON.stringify(
			{
				rows,
				uniquePaths,
				afterRows,
				before,
				afterMigration,
				upgrade,
				cleanup,
				remaining,
				note: "Local synthetic SQLite and filesystem; no NFS failure simulation. No VACUUM. Migration HTTP endpoint excludes database access.",
			},
			null,
			2,
		),
	);
} finally {
	if (server) await new Promise((resolve) => server.close(resolve));
	await database.destroy();
	await rm(dir, { recursive: true, force: true });
}
