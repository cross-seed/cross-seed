import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Knex } from "knex";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { cacheEnsembleDataEntries } from "../src/ensemble.js";
import type { EnsembleDataEntry } from "../src/ensemble.js";
import schema from "../src/migrations/09-clientAndDataSearchees.js";
import migration from "../src/migrations/18-unique-ensemble-data-mappings.js";

const entry: EnsembleDataEntry = {
	client_host: null,
	info_hash: null,
	path: "/data/Show.S01E01.mkv",
	ensemble: "show.S1",
	element: "1",
};

describe("ensemble data mapping migration and cache", () => {
	let database: Knex;
	let directory: string;

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "cross-seed-ensemble-"));
		vi.stubEnv("CONFIG_DIR", directory);
		({ db: database } = await import("../src/db.js"));
		await schema.up(database);
	});

	beforeEach(async () => {
		await migration.down(database);
		await database("ensemble").del();
	});

	afterAll(async () => {
		await database?.destroy();
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});

	it("migrates an empty cache and handles empty input", async () => {
		await database.transaction(migration.up);
		await cacheEnsembleDataEntries(database, []);
		expect(await database("ensemble")).toEqual([]);
	});

	it("removes only duplicate data mappings and preserves other sources", async () => {
		const distinct = [
			entry,
			{ ...entry, ensemble: "alternate.S1" },
			{ ...entry, element: "2" },
			{ ...entry, element: "1.10" },
			{ ...entry, element: "1.1" },
			{ ...entry, path: "/data/another.mkv" },
			{ ...entry, info_hash: "a".repeat(40) },
			{ ...entry, client_host: "client-a" },
			{ ...entry, client_host: "client-b" },
		];
		const torrent = distinct[6];
		await database("ensemble").insert([
			...distinct,
			torrent,
			entry,
			distinct[1],
		]);
		await database.transaction(migration.up);
		expect(await database("ensemble")).toHaveLength(distinct.length + 1);
		for (const row of distinct) {
			expect(await database("ensemble").where(row)).toHaveLength(
				row === torrent ? 2 : 1,
			);
		}
	});

	it("keeps repeated indexing bounded, including duplicates across batches", async () => {
		await database.transaction(migration.up);
		const entries = Array.from({ length: 102 }, (_, i) => ({
			...entry,
			path: `/data/episode-${i}.mkv`,
		}));
		await cacheEnsembleDataEntries(database, [
			entries[0],
			...entries,
			entries[0],
		]);
		await cacheEnsembleDataEntries(database, entries);
		expect(await database("ensemble").orderBy("path")).toEqual(
			[...entries].sort((a, b) => a.path.localeCompare(b.path)),
		);
	});

	it("preserves alternate titles and elements during reindexing", async () => {
		await database.transaction(migration.up);
		const entries = [
			entry,
			{ ...entry, ensemble: "alternate.S1" },
			{ ...entry, element: "2" },
		];
		await cacheEnsembleDataEntries(database, entries);
		await cacheEnsembleDataEntries(database, [entry]);
		expect(await database("ensemble")).toHaveLength(entries.length);
		for (const row of entries) {
			expect(await database("ensemble").where(row)).toEqual([row]);
		}
	});

	it("keeps numeric episode elements stable across repeated indexing", async () => {
		await database.transaction(migration.up);
		const episode = { ...entry, element: 1 };
		await cacheEnsembleDataEntries(database, [episode, episode]);
		const rows = await database("ensemble");
		await cacheEnsembleDataEntries(database, [episode]);
		expect(rows).toHaveLength(1);
		expect(await database("ensemble")).toEqual(rows);
	});

	it("rejects direct duplicate inserts after migration", async () => {
		await database.transaction(migration.up);
		await database("ensemble").insert(entry);
		await expect(database("ensemble").insert(entry)).rejects.toThrow(
			"UNIQUE constraint failed",
		);
	});

	it("leaves torrentDir and client conflict targets working", async () => {
		await database.transaction(migration.up);
		await cacheEnsembleDataEntries(database, [entry]);
		const torrent = { ...entry, info_hash: "a".repeat(40) };
		const clients = [
			{ ...entry, client_host: "client-a" },
			{ ...entry, client_host: "client-b" },
		];
		for (let i = 0; i < 2; i++) {
			await database("ensemble")
				.insert([torrent, ...clients])
				.onConflict(["client_host", "path"])
				.merge();
		}
		expect(await database("ensemble").where(entry)).toEqual([entry]);
		expect(await database("ensemble").where(torrent)).toHaveLength(2);
		for (const client of clients) {
			expect(await database("ensemble").where(client)).toEqual([client]);
		}
	});

	it("rolls back cleanup and the constraint with the migration transaction", async () => {
		await database("ensemble").insert([entry, entry]);
		await expect(
			database.transaction(async (trx) => {
				await migration.up(trx);
				throw new Error("migration interrupted");
			}),
		).rejects.toThrow("migration interrupted");
		expect(await database("ensemble")).toEqual([entry, entry]);
		await database("ensemble").insert(entry);
		expect(await database("ensemble")).toHaveLength(3);
	});

	it("removes the constraint on rollback without deleting mappings", async () => {
		await database.transaction(migration.up);
		await cacheEnsembleDataEntries(database, [entry]);
		await migration.down(database);
		await database("ensemble").insert(entry);
		expect(await database("ensemble")).toEqual([entry, entry]);
	});
});
