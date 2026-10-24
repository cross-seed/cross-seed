import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeSqliteClient } from "../src/db.js";
import oldSchema from "../src/migrations/09-clientAndDataSearchees.js";
import migration from "../src/migrations/20-ensemble-identity.js";
import { replaceEnsembleEntries } from "../src/ensemble.js";
import { pruneMissingFileEntries } from "../src/ensembleCleanup.js";
import type { EnsembleEntry } from "../src/torrent.js";

let database: Knex;
let dir: string;
const entry: EnsembleEntry = {
	client_host: null,
	path: "/show/episode.mkv",
	info_hash: null,
	ensemble: "show.1",
	element: "1",
};
async function migrate() {
	await database.transaction((trx) => migration.up(trx));
}

describe("ensemble identity and bounded cleanup", () => {
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ensemble-test-"));
		database = knex({
			client: NodeSqliteClient,
			connection: { filename: join(dir, "test.db") },
			useNullAsDefault: true,
		});
		await oldSchema.up(database);
	});
	afterEach(async () => {
		await database.destroy();
		await rm(dir, { recursive: true, force: true });
	});

	it("reproduces legacy null-key growth, upgrades exact duplicates, and makes repeated indexing idempotent", async () => {
		for (let i = 0; i < 3; i++)
			await database("ensemble")
				.insert(entry)
				.onConflict(["client_host", "path"])
				.merge();
		expect(await database("ensemble").select()).toHaveLength(3); // Legacy red.
		await migrate();
		expect(await database("ensemble").select()).toEqual([entry]);
		for (let i = 0; i < 3; i++)
			await replaceEnsembleEntries(database, [entry]);
		expect(await database("ensemble").select()).toEqual([entry]);
	});

	it("preserves aliases, episodes, torrent identities, client hosts, and null versus empty values", async () => {
		const variants = [
			entry,
			{ ...entry, ensemble: "alternate-title.1" },
			{ ...entry, element: "2" },
			{ ...entry, info_hash: "torrent-a" },
			{ ...entry, info_hash: "torrent-b" },
			{ ...entry, client_host: "client-a" },
			{ ...entry, client_host: "client-b" },
			{ ...entry, client_host: "" },
		];
		for (const row of variants) await database("ensemble").insert(row);
		await database("ensemble").insert(entry);
		await migrate();
		expect(await database("ensemble").select()).toHaveLength(
			variants.length,
		);
		expect(await database("ensemble").select()).toEqual(
			expect.arrayContaining(variants),
		);
		await replaceEnsembleEntries(database, variants);
		await replaceEnsembleEntries(database, variants);
		expect(await database("ensemble").select()).toHaveLength(
			variants.length,
		);
	});

	it("replaces stale aliases for a refreshed source without deleting other sources", async () => {
		await migrate();
		const otherSource = { ...entry, info_hash: "other-torrent" };
		await replaceEnsembleEntries(database, [
			entry,
			{ ...entry, ensemble: "old-alias" },
			otherSource,
		]);
		const updated = {
			...entry,
			ensemble: "corrected-title.2",
			element: "7",
		};
		await replaceEnsembleEntries(database, [updated]);
		expect(await database("ensemble").select()).toHaveLength(2);
		expect(await database("ensemble").select()).toEqual(
			expect.arrayContaining([updated, otherSource]),
		);
	});

	it("retains multiple aliases for clients instead of overwriting them", async () => {
		await migrate();
		const aliases = ["first", "second"].map((ensemble) => ({
			...entry,
			client_host: "client",
			info_hash: "hash",
			ensemble,
		}));
		await replaceEnsembleEntries(database, aliases);
		expect(await database("ensemble").select()).toHaveLength(2);
	});

	it("rolls back a failed migration without losing the old cache", async () => {
		await database("ensemble").insert([entry, entry]);
		await expect(
			database.transaction(async (trx) => {
				await migration.up(trx);
				throw new Error("simulated interruption");
			}),
		).rejects.toThrow("simulated interruption");
		expect(await database("ensemble").select()).toHaveLength(2);
		expect(await database.schema.hasTable("ensemble_next")).toBe(false);
		await migrate();
		expect(await database("ensemble").select()).toHaveLength(1);
	});

	it("pages unique paths once, limits concurrent checks, and removes all aliases for missing paths", async () => {
		await migrate();
		const entries = Array.from({ length: 600 }, (_, i) => ({
			...entry,
			path: `/path/${String(i).padStart(4, "0")}`,
		}));
		await replaceEnsembleEntries(
			database,
			entries.flatMap((row) => [row, { ...row, ensemble: "alias" }]),
		);
		let active = 0;
		let peak = 0;
		const visited = new Set<string>();
		await pruneMissingFileEntries(database, "ensemble", async (path) => {
			expect(visited.has(path)).toBe(false);
			visited.add(path);
			peak = Math.max(peak, ++active);
			await setTimeout(1);
			active--;
			return Number(path.slice(-4)) % 2 === 0;
		});
		expect(visited.size).toBe(600);
		expect(peak).toBeLessThanOrEqual(16);
		expect(await database("ensemble").select()).toHaveLength(600);
	});

	it("checks the real filesystem and preserves existing files", async () => {
		await migrate();
		const existing = join(dir, "existing.mkv");
		const missing = join(dir, "missing.mkv");
		await writeFile(existing, "test");
		await replaceEnsembleEntries(database, [
			{ ...entry, path: existing },
			{ ...entry, path: missing },
		]);
		await database("data").insert([
			{ path: existing, title: "exists" },
			{ path: missing, title: "missing" },
		]);
		await pruneMissingFileEntries(database, "data");
		expect(await database("ensemble").pluck("path")).toEqual([existing]);
		expect(await database("data").pluck("path")).toEqual([existing]);
	});
});
