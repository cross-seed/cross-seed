import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("upgrades a populated pre-inventory database without changing settings or search history", async () => {
	const configDir = await mkdtemp(join(tmpdir(), "cross-seed-upgrade-"));
	const previousConfigDir = process.env.CONFIG_DIR;
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();
	const { db } = await import("../src/db.js");
	try {
		const { createAppDirHierarchy } =
			await import("../src/configuration.js");
		const { migrations } = await import("../src/migrations/migrations.js");
		createAppDirHierarchy();
		await db.migrate.latest({
			migrationSource: {
				...migrations,
				getMigrations: async () =>
					(await migrations.getMigrations()).filter(
						(migration) => migration.name < "18-",
					),
			},
		});
		expect(await db.schema.hasTable("library_item")).toBe(false);
		await db("settings")
			.where({ id: 0 })
			.update({
				settings_json: JSON.stringify({
					apiKey: "upgrade-test",
					dataDirs: ["/media"],
				}),
			});
		// Seed the historical schema directly, including fields hidden by current insert types.
		await db.raw(
			"INSERT INTO searchee (id, name, first_searched, last_searched) VALUES (?, ?, ?, ?)",
			[1, "Previously searched", 100, 200],
		);
		await db.raw("INSERT INTO indexer (id, url, active) VALUES (?, ?, ?)", [
			1,
			"http://indexer.invalid",
			1,
		]);
		await db("timestamp").insert({
			searchee_id: 1,
			indexer_id: 1,
			first_searched: 100,
			last_searched: 200,
		});
		await db.raw(
			"INSERT INTO decision (searchee_id, guid, info_hash, decision, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
			[1, "old-guid", "old-hash", "MATCH", 100, 200],
		);
		await db("torrent").insert({
			info_hash: "old-hash",
			name: "Old torrent",
			file_path: "/watch/old.torrent",
		});
		await db("data").insert({ path: "/media/old.mkv", title: "Old" });
		const tables = [
			"settings",
			"searchee",
			"indexer",
			"timestamp",
			"decision",
			"torrent",
			"data",
		];
		const before = await Promise.all(
			tables.map((table) => db(table).select()),
		);
		await db.migrate.latest({ migrationSource: migrations });
		expect(await db.schema.hasTable("library_file")).toBe(true);
		expect(await db("library_item")).toHaveLength(0);

		// The first successful source refresh fills inventory without performing a search.
		const { updateSearcheeClientDB } = await import("../src/searchee.js");
		const item = {
			clientHost: "client-a",
			infoHash: "new-hash",
			name: "New.Show.S01E01",
			title: "New Show S01E01",
			files: [{ name: "episode.mkv", path: "episode.mkv", length: 100 }],
			length: 100,
			savePath: "/downloads",
			category: "tv",
			tags: [],
			trackers: [],
		};
		await updateSearcheeClientDB(
			"client-a",
			[item],
			new Set([item.infoHash]),
		);
		const first = await db("library_item").first();
		expect(first).toBeDefined();
		if (!first) throw new Error("First refresh did not populate inventory");
		await db.migrate.latest();
		await updateSearcheeClientDB(
			"client-a",
			[item],
			new Set([item.infoHash]),
		);
		expect(await db("library_item")).toHaveLength(1);
		expect(await db("library_item").first()).toMatchObject({
			id: first.id,
			first_seen_at: first.first_seen_at,
			missing_since: null,
		});
		expect(
			await Promise.all(tables.map((table) => db(table).select())),
		).toEqual(before);
	} finally {
		await db.destroy();
		if (previousConfigDir === undefined) delete process.env.CONFIG_DIR;
		else process.env.CONFIG_DIR = previousConfigDir;
		await rm(configDir, { recursive: true, force: true });
	}
});
