import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import knex, { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	cacheEnsembleDataEntries,
	cleanupDuplicateEnsembleDataEntries,
	EnsembleDataEntry,
} from "../src/ensemble.js";
import schema from "../src/migrations/09-clientAndDataSearchees.js";

const entry: EnsembleDataEntry = {
	client_host: null,
	info_hash: null,
	path: "/data/Show.S01E01.mkv",
	ensemble: "show.S1",
	element: "1",
};

describe("ensemble data cache", () => {
	let database: Knex;
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cross-seed-ensemble-"));
		database = knex({
			client: "better-sqlite3",
			connection: { filename: join(directory, "test.db") },
			useNullAsDefault: true,
		});
		await database.raw("PRAGMA journal_mode = WAL");
		await schema.up(database);
	});

	afterEach(async () => {
		await database.destroy();
		await rm(directory, { recursive: true, force: true });
	});

	it("handles empty input and an empty cache", async () => {
		await cacheEnsembleDataEntries(database, []);
		expect(await cleanupDuplicateEnsembleDataEntries(database)).toBe(0);
		expect(await database("ensemble")).toEqual([]);
	});

	it("keeps one copy across repeated indexing and batch boundaries", async () => {
		const entries = Array.from({ length: 102 }, (_, i) => ({
			...entry,
			path: `/data/episode-${i}.mkv`,
		}));
		await cacheEnsembleDataEntries(database, [...entries, entries[0]]);
		await cacheEnsembleDataEntries(database, entries);
		expect(await database("ensemble").orderBy("path")).toEqual(
			[...entries].sort((a, b) => a.path.localeCompare(b.path)),
		);
	});

	it("keeps numeric episode elements stable across repeated indexing", async () => {
		const episode = { ...entry, element: 1 };
		await cacheEnsembleDataEntries(database, [episode, episode]);
		await cacheEnsembleDataEntries(database, [episode]);
		expect(await database("ensemble")).toEqual([
			{ ...episode, element: "1.0" },
		]);
	});

	it("preserves other titles, elements, paths and torrent sources", async () => {
		const distinct = [
			entry,
			{ ...entry, ensemble: "alternate.S1" },
			{ ...entry, element: "2" },
			{ ...entry, path: "/data/another.mkv" },
			{ ...entry, info_hash: "a".repeat(40) },
			{ ...entry, client_host: "client-a" },
			{ ...entry, client_host: "client-b" },
		];
		await database("ensemble").insert(distinct);
		await cacheEnsembleDataEntries(database, [entry, entry]);
		expect(await database("ensemble")).toHaveLength(distinct.length);
		for (const row of distinct) {
			expect(await database("ensemble").where(row)).toEqual([row]);
		}
	});

	it("rolls back a batch if an entry cannot be inserted", async () => {
		await database("ensemble").insert(entry);
		await database.raw(`
			CREATE TRIGGER reject_ensemble_insert BEFORE INSERT ON ensemble
			WHEN NEW.ensemble = 'rejected.S1'
			BEGIN SELECT RAISE(ABORT, 'insert rejected'); END
		`);
		await expect(
			cacheEnsembleDataEntries(database, [
				{ ...entry, path: "/data/new.mkv" },
				{ ...entry, ensemble: "rejected.S1" },
			]),
		).rejects.toThrow("insert rejected");
		expect(await database("ensemble")).toEqual([entry]);
	});

	it("cleans only exact dataDirs duplicates, preserving other sources", async () => {
		const distinct = [
			entry,
			{ ...entry, ensemble: "alternate.S1" },
			{ ...entry, element: "2" },
			{ ...entry, path: "/data/another.mkv" },
			{ ...entry, info_hash: "a".repeat(40) },
			{ ...entry, client_host: "client-a" },
			{ ...entry, client_host: "client-b" },
		];
		// Duplicate torrentDir rows must remain outside dataDirs cleanup.
		await database("ensemble").insert([...distinct, distinct[4], entry]);
		// Reindexing must leave cleanup able to detect duplicates and vacuum.
		await cacheEnsembleDataEntries(database, [entry]);
		expect(await cleanupDuplicateEnsembleDataEntries(database)).toBe(1);
		expect(await database("ensemble")).toHaveLength(distinct.length + 1);
		for (const row of distinct) {
			expect(await database("ensemble").where(row)).toHaveLength(
				row === distinct[4] ? 2 : 1,
			);
		}
		expect(await cleanupDuplicateEnsembleDataEntries(database)).toBe(0);
	});

	it("removes duplicates across cleanup batches and vacuums freed pages", async () => {
		for (let i = 0; i < 101; i++) {
			await database("ensemble").insert(Array(100).fill(entry));
		}
		const [{ page_count: pagesBefore }] =
			await database.raw("PRAGMA page_count");
		expect(await cleanupDuplicateEnsembleDataEntries(database)).toBe(10099);
		expect(await database("ensemble")).toEqual([entry]);
		const [{ page_count: pagesAfter }] =
			await database.raw("PRAGMA page_count");
		expect(pagesAfter).toBeLessThan(pagesBefore);
		expect(await database.raw("PRAGMA freelist_count")).toEqual([
			{ freelist_count: 0 },
		]);
	});

	it("does not vacuum when there are no dataDirs duplicates", async () => {
		await database.schema.createTable("scratch", (table) => {
			table.text("value");
		});
		await database("scratch").insert({ value: "x".repeat(100000) });
		await database("scratch").del();
		await database("ensemble").insert(entry);
		const freePages = await database.raw("PRAGMA freelist_count");
		expect(freePages[0].freelist_count).toBeGreaterThan(0);
		expect(await cleanupDuplicateEnsembleDataEntries(database)).toBe(0);
		expect(await database.raw("PRAGMA freelist_count")).toEqual(freePages);
		expect(await database("ensemble")).toEqual([entry]);
	});
});
