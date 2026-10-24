import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = await readFile(
	new URL("./fixtures/upgrades/v6.13.9.sql", import.meta.url),
	"utf8",
);
const apiKey = "a".repeat(32);
const fileConfig = `module.exports = {
 delay: 123, useClientTorrents: false, outputDir: "/output",
 torrentClients: ["qbittorrent:http://localhost:8080"],
 torznab: ["https://indexer.example/api?apikey=test-key"],
 searchCadence: "2h", linkDir: "/links", dataDirs: ["/data"]
};`;
let currentDb: typeof import("../src/db.js").db | undefined;
const originalConfigDir = process.env.CONFIG_DIR;

async function legacyDirectory(key: string | null = apiKey) {
	const dir = await mkdtemp(join(tmpdir(), "cross-seed-upgrade-"));
	const sqlite = new DatabaseSync(join(dir, "cross-seed.db"));
	try {
		sqlite.exec(fixture);
		sqlite.prepare("UPDATE settings SET apikey = ?").run(key);
		sqlite.exec(`
   INSERT INTO searchee(id,name) VALUES (1,'Example.Movie');
   INSERT INTO decision(searchee_id,guid,info_hash,decision,first_seen,last_seen) VALUES (1,'test-guid','1111111111111111111111111111111111111111','MATCH',100,200);
   INSERT INTO indexer(id,url,apikey,active) VALUES (1,'https://indexer.example/api','test-key',1),(2,'https://retired.example/api','old-key',0);
   INSERT INTO timestamp(searchee_id,indexer_id,first_searched,last_searched) VALUES (1,1,100,200),(1,2,100,200);
   INSERT INTO rss(indexer_id,last_seen_guid) VALUES (1,'rss-guid'),(2,'retired-guid');
   INSERT INTO job_log(name,last_run) VALUES ('search',123456);
  `);
	} finally {
		sqlite.close();
	}
	await writeFile(join(dir, "config.js"), fileConfig);
	return dir;
}

async function open(dir: string) {
	process.env.CONFIG_DIR = dir;
	vi.resetModules();
	const { db } = await import("../src/db.js");
	currentDb = db;
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { determineRuntimeConfig, handleExitSignal } =
		await import("../src/startup.js");
	process.off("SIGINT", handleExitSignal);
	process.off("SIGTERM", handleExitSignal);
	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	const { migrations } = await import("../src/migrations/migrations.js");
	return { db, determineRuntimeConfig, migrations };
}

async function reopen(dir: string) {
	await currentDb?.destroy();
	currentDb = undefined;
	// A fresh path avoids native import() caching, as a process restart would.
	const next = await mkdtemp(join(tmpdir(), "cross-seed-upgrade-restart-"));
	await cp(dir, next, { recursive: true });
	return { dir: next, ...(await open(next)) };
}

describe.sequential("v6 database upgrades", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await currentDb?.destroy();
		currentDb = undefined;
		if (originalConfigDir === undefined) delete process.env.CONFIG_DIR;
		else process.env.CONFIG_DIR = originalConfigDir;
	});

	it("deduplicates only identical legacy ensemble entries through the complete migration chain", async () => {
		const dir = await legacyDirectory();
		const env = await open(dir);
		const row = {
			client_host: null,
			path: "/episodes/one.mkv",
			info_hash: null,
			ensemble: "show.1",
			element: "1",
		};
		await env
			.db("ensemble")
			.insert([
				row,
				row,
				{ ...row, ensemble: "alias.1" },
				{ ...row, info_hash: "hash" },
			]);
		await env.db.migrate.latest();
		expect(await env.db("ensemble").select()).toHaveLength(3);
		const { replaceEnsembleEntries } = await import("../src/ensemble.js");
		await replaceEnsembleEntries(env.db, [
			row,
			{ ...row, ensemble: "alias.1" },
		]);
		expect(await env.db("ensemble").select()).toHaveLength(3);
		const restarted = await reopen(dir);
		await restarted.db.migrate.latest();
		expect(await restarted.db("ensemble").select()).toHaveLength(3);
	});

	it.each([apiKey, null, ""])(
		"imports the frozen v6 schema and preserves data (legacy key: %s)",
		async (key) => {
			const dir = await legacyDirectory(key);
			const env = await open(dir);
			const history = await env.db("decision").select();
			const jobs = await env.db("job_log").select();
			expect(await env.db.raw("PRAGMA table_info(settings)")).not.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "settings_json" }),
				]),
			);
			await env.db.migrate.latest();
			const config = await env.determineRuntimeConfig({});
			expect(config).toMatchObject({
				delay: 123,
				searchCadence: 7200000,
				linkDirs: ["/links"],
				dataDirs: ["/data"],
				torrentClients: ["qbittorrent:http://localhost:8080"],
			});
			if (key) expect(config.apiKey).toBe(key);
			expect(await env.db("decision").select()).toEqual(history);
			expect(await env.db("job_log").select()).toEqual(jobs);
			expect(await env.db("indexer").select("url", "apikey")).toEqual([
				{ url: "https://indexer.example/api", apikey: "test-key" },
			]);
			expect(await env.db("timestamp").select()).toEqual([
				{
					searchee_id: 1,
					indexer_id: 1,
					first_searched: 100,
					last_searched: 200,
				},
			]);
			expect(await env.db("rss").select()).toEqual([
				{ indexer_id: 1, last_seen_guid: "rss-guid" },
			]);
			for (const table of [
				"library_item",
				"library_file",
				"library_scan",
			])
				expect(await env.db.schema.hasTable(table)).toBe(true);
			expect(await env.db.raw("PRAGMA integrity_check")).toEqual([
				{ integrity_check: "ok" },
			]);
			expect(await env.db.raw("PRAGMA foreign_key_check")).toEqual([]);
			const settings = await env.db("settings").select();
			const ledger = await env.db("knex_migrations").select();
			const restarted = await reopen(dir);
			await restarted.db.migrate.latest();
			expect(await restarted.determineRuntimeConfig({})).toEqual(config);
			expect(await restarted.db("settings").select()).toEqual(settings);
			expect(await restarted.db("knex_migrations").select()).toEqual(
				ledger,
			);
			expect(
				(await readdir(restarted.dir)).filter((n) =>
					n.startsWith("config.js"),
				),
			).toEqual(["config.js.bak"]);
		},
	);

	it.each(["module.exports = {", "module.exports = { delay: 1 };"])(
		"recovers on restart after an invalid legacy file: %s",
		async (invalid) => {
			const dir = await legacyDirectory();
			await writeFile(join(dir, "config.js"), invalid);
			const env = await open(dir);
			await env.db.migrate.latest();
			const settings = await env.db("settings").select();
			await expect(env.determineRuntimeConfig({})).rejects.toThrow(
				"Failed to import configuration file",
			);
			expect(await env.db("settings").select()).toEqual(settings);
			expect(await readFile(join(dir, "config.js"), "utf8")).toBe(
				invalid,
			);
			await writeFile(join(dir, "config.js"), fileConfig);
			const restarted = await reopen(dir);
			await restarted.db.migrate.latest();
			await expect(
				restarted.determineRuntimeConfig({}),
			).resolves.toMatchObject({ delay: 123, apiKey });
		},
	);

	it("rolls back a failed migration batch and can retry without losing legacy data", async () => {
		const dir = await legacyDirectory();
		const env = await open(dir);
		const ledger = await env.db("knex_migrations").select();
		const history = await env.db("decision").select();
		const original = env.migrations.getMigration;
		const injected = vi
			.spyOn(env.migrations, "getMigration")
			.mockImplementation(async (migration) => {
				const resolved = await original(migration);
				if (migration.name !== "18-library-inventory") return resolved;
				return {
					...resolved,
					up: async (db) => {
						await resolved.up(db);
						throw new Error("simulated migration failure");
					},
				};
			});
		await expect(env.db.migrate.latest()).rejects.toThrow(
			"simulated migration failure",
		);
		injected.mockRestore();
		expect(await env.db("knex_migrations").select()).toEqual(ledger);
		expect(await env.db("decision").select()).toEqual(history);
		expect(await env.db.raw("PRAGMA table_info(settings)")).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "settings_json" }),
			]),
		);
		expect(await env.db.schema.hasTable("library_item")).toBe(false);
		const restarted = await reopen(dir);
		await restarted.db.migrate.latest();
		await expect(
			restarted.determineRuntimeConfig({}),
		).resolves.toMatchObject({ delay: 123, apiKey });
	});
	it("upgrades an existing v7 database without overwriting settings or login state", async () => {
		const dir = await legacyDirectory();
		const env = await open(dir);
		const all = await env.migrations.getMigrations();
		const boundary = vi
			.spyOn(env.migrations, "getMigrations")
			.mockResolvedValue(all.slice(0, 18));
		await env.db.migrate.latest();
		boundary.mockRestore();
		await env.determineRuntimeConfig({});
		await env
			.db("settings")
			.update({ settings_json: JSON.stringify({ apiKey, delay: 456 }) });
		await env.db("user").insert({
			username: "upgrade-user",
			password: "synthetic-password-hash",
		});
		const user = await env.db<{ id: number }>("user").first();
		await env.db("session").insert({
			id: "test-session",
			user_id: user!.id,
			expires_at: 1900000000000,
			created_at: 1700000000000,
		});
		const users = await env.db("user").select();
		const sessions = await env.db("session").select();
		// A stale config must not replace settings changed through v7.
		await writeFile(join(dir, "config.js"), fileConfig);
		const restarted = await reopen(dir);
		await restarted.db.migrate.latest();
		await expect(
			restarted.determineRuntimeConfig({}),
		).resolves.toMatchObject({ delay: 456, apiKey });
		expect(await restarted.db("user").select()).toEqual(users);
		expect(await restarted.db("session").select()).toEqual(sessions);
		expect(await restarted.db.schema.hasTable("library_file")).toBe(true);
	});

	it("recovers an already-applied API-key-only migration after reopening the database", async () => {
		const dir = await legacyDirectory();
		const env = await open(dir);
		await env.db.migrate.latest();
		// Persist precisely the state left by the old migration 17, including its ledger.
		await env
			.db("settings")
			.update({ settings_json: JSON.stringify({ apiKey }) });
		const restarted = await reopen(dir);
		const ledger = await restarted.db("knex_migrations").select();
		await restarted.db.migrate.latest();
		await expect(
			restarted.determineRuntimeConfig({}),
		).resolves.toMatchObject({ delay: 123, apiKey });
		expect(await restarted.db("knex_migrations").select()).toEqual(ledger);
		expect(await restarted.db("indexer").select()).toHaveLength(1);
	});
});
