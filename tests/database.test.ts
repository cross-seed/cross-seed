import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import knex from "knex";
import { expect, it, vi } from "vitest";
import { migrations } from "../src/migrations/migrations.js";

const config = vi.hoisted(() => ({ directory: "" }));
// Migration 11 also renames torrent-cache files. Keep that unrelated application
// dependency graph out of this native-driver test; the temporary cache is empty.
vi.mock("../src/configuration.js", () => ({ appDir: () => config.directory }));
vi.mock("../src/decide.js", () => ({ getCachedTorrentName: vi.fn() }));
vi.mock("../src/torrent.js", () => ({
	findAllTorrentFilesInDir: vi.fn(),
	parseMetadataFromFilename: vi.fn(),
}));

it("runs v6 migrations and preserves data across SQLite connections", async () => {
	const directory = await mkdtemp(join(tmpdir(), "cross-seed-sqlite-"));
	config.directory = directory;
	const filename = join(directory, "cross-seed.db");
	const raw = new Sqlite(filename);
	raw.pragma("journal_mode = WAL");
	raw.close();
	const db = knex({
		client: "better-sqlite3",
		connection: { filename },
		migrations: { migrationSource: migrations },
		useNullAsDefault: true,
	});
	try {
		await db.migrate.latest();
		await db("searchee").insert({ name: "Existing title" });
		await expect(
			db.transaction(async (trx) => {
				await trx("searchee").insert({ name: "Rolled back" });
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		await db.migrate.latest();
		await db.destroy();
		const reopened = new Sqlite(filename);
		try {
			expect(reopened.pragma("journal_mode", { simple: true })).toBe(
				"wal",
			);
			expect(reopened.prepare("SELECT name FROM searchee").all()).toEqual(
				[{ name: "Existing title" }],
			);
			expect(reopened.pragma("integrity_check", { simple: true })).toBe(
				"ok",
			);
		} finally {
			reopened.close();
		}
	} finally {
		await db.destroy();
		await rm(directory, { recursive: true, force: true });
	}
});
