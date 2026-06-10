import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = await mkdtemp(
	join(tmpdir(), "cross-seed-library-inventory-tests-"),
);

type LibraryInventoryEnv = {
	db: typeof import("../src/db.js").db;
	inventory: typeof import("../src/libraryInventory.js");
	updateSearcheeClientDB: typeof import("../src/searchee.js").updateSearcheeClientDB;
};

async function createLibraryInventoryEnv(): Promise<LibraryInventoryEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const inventory = await import("../src/libraryInventory.js");
	const { updateSearcheeClientDB } = await import("../src/searchee.js");

	createAppDirHierarchy();
	await db.migrate.latest();

	return { db, inventory, updateSearcheeClientDB };
}

describe.sequential("library inventory sync", () => {
	let env: LibraryInventoryEnv;

	beforeEach(async () => {
		env = await createLibraryInventoryEnv();
	});

	afterEach(async () => {
		await env.db.destroy();
	});

	it("creates stable source keys for each persisted inventory source", () => {
		expect(
			env.inventory.createClientLibrarySourceKey({
				clientHost: "http://qbittorrent",
				infoHash: "abc123",
			}),
		).toBe("torrentClient:http://qbittorrent:abc123");
		expect(
			env.inventory.createTorrentLibrarySourceKey("/watch/a.torrent"),
		).toBe("torrentFile:/watch/a.torrent");
		expect(env.inventory.createDataLibrarySourceKey("/media/show")).toBe(
			"dataDir:/media/show",
		);
	});

	it("upserts indexed items without replacing their first seen time", async () => {
		const sourceKey = env.inventory.createClientLibrarySourceKey({
			clientHost: "client-a",
			infoHash: "hash-a",
		});
		const firstScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.CLIENT,
			sourceInstance: "client-a",
			now: 1_000,
		});

		await env.inventory.upsertLibraryItems(
			firstScan.id,
			[
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-a",
					sourceKey,
					clientHost: "client-a",
					infoHash: "hash-a",
					name: "Raw.Name.S01E01",
					title: "Parsed Name S01E01",
					files: [
						{
							name: "episode.mkv",
							path: "/downloads/episode.mkv",
							length: 100,
						},
					],
					length: 100,
					savePath: "/downloads",
					category: "tv",
					tags: ["cross-seed"],
					trackers: ["tracker-a"],
					contentFingerprint: "fingerprint-1",
				},
			],
			{ now: 1_100 },
		);
		await env.inventory.completeLibraryScan(firstScan.id, { now: 1_200 });

		const secondScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.CLIENT,
			sourceInstance: "client-a",
			now: 2_000,
		});
		await env.inventory.upsertLibraryItems(
			secondScan.id,
			[
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-a",
					sourceKey,
					clientHost: "client-a",
					infoHash: "hash-a",
					name: "Raw.Name.S01E01",
					title: "Parsed Name S01E01",
					files: [
						{
							name: "episode.mkv",
							path: "/downloads/episode.mkv",
							length: 125,
						},
					],
					length: 125,
					savePath: "/downloads",
					category: "tv",
					tags: ["cross-seed", "updated"],
					trackers: ["tracker-a", "tracker-b"],
					contentFingerprint: "fingerprint-2",
				},
			],
			{ now: 2_100 },
		);

		const row = await env
			.db("library_item")
			.where({ source_key: sourceKey })
			.first();
		const scan = await env.inventory.getLibraryScan(secondScan.id);

		expect(row).toMatchObject({
			source: env.inventory.LibraryItemSource.CLIENT,
			source_instance: "client-a",
			client_host: "client-a",
			info_hash: "hash-a",
			name: "Raw.Name.S01E01",
			title: "Parsed Name S01E01",
			length: 125,
			first_seen_at: 1_100,
			last_seen_at: 2_100,
			last_indexed_at: 2_100,
			missing_since: null,
			last_seen_scan_id: secondScan.id,
			content_fingerprint: "fingerprint-2",
		});
		expect(JSON.parse(row!.files)).toEqual([
			{
				name: "episode.mkv",
				path: "/downloads/episode.mkv",
				length: 125,
			},
		]);
		expect(JSON.parse(row!.tags!)).toEqual(["cross-seed", "updated"]);
		expect(JSON.parse(row!.trackers!)).toEqual(["tracker-a", "tracker-b"]);
		expect(scan).toMatchObject({
			itemsSeen: 1,
			itemsUpserted: 1,
			itemsRemoved: 0,
		});
	});

	it("tombstones missing items only within a successful scan scope", async () => {
		const keptKey = env.inventory.createClientLibrarySourceKey({
			clientHost: "client-a",
			infoHash: "kept",
		});
		const missingKey = env.inventory.createClientLibrarySourceKey({
			clientHost: "client-a",
			infoHash: "missing",
		});
		const otherClientKey = env.inventory.createClientLibrarySourceKey({
			clientHost: "client-b",
			infoHash: "other",
		});
		const firstScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.CLIENT,
			sourceInstance: "client-a",
			now: 1_000,
		});

		await env.inventory.upsertLibraryItems(
			firstScan.id,
			[
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-a",
					sourceKey: keptKey,
					clientHost: "client-a",
					infoHash: "kept",
					name: "Kept",
					title: "Kept",
					files: [],
					length: 0,
				},
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-a",
					sourceKey: missingKey,
					clientHost: "client-a",
					infoHash: "missing",
					name: "Missing",
					title: "Missing",
					files: [],
					length: 0,
				},
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-b",
					sourceKey: otherClientKey,
					clientHost: "client-b",
					infoHash: "other",
					name: "Other",
					title: "Other",
					files: [],
					length: 0,
				},
			],
			{ now: 1_100 },
		);
		await env.inventory.completeLibraryScan(firstScan.id, { now: 1_200 });

		const secondScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.CLIENT,
			sourceInstance: "client-a",
			now: 2_000,
		});
		await env.inventory.markLibraryItemsSeen(secondScan.id, [keptKey], {
			now: 2_100,
		});
		await env.inventory.completeLibraryScan(secondScan.id, { now: 2_200 });

		await expect(
			env.inventory.pruneMissingLibraryItems(secondScan.id, {
				now: 2_300,
			}),
		).resolves.toBe(1);

		const rows = await env
			.db("library_item")
			.select("source_key", "missing_since", "last_seen_scan_id");
		const bySourceKey = new Map(rows.map((row) => [row.source_key, row]));
		const scan = await env.inventory.getLibraryScan(secondScan.id);

		expect(bySourceKey.get(keptKey)).toMatchObject({
			missing_since: null,
			last_seen_scan_id: secondScan.id,
		});
		expect(bySourceKey.get(missingKey)).toMatchObject({
			missing_since: 2_300,
			last_seen_scan_id: firstScan.id,
		});
		expect(bySourceKey.get(otherClientKey)).toMatchObject({
			missing_since: null,
			last_seen_scan_id: firstScan.id,
		});
		expect(scan?.itemsRemoved).toBe(1);
	});

	it("marks unchanged fingerprint items seen without rewriting indexed metadata", async () => {
		const sourceKey =
			env.inventory.createDataLibrarySourceKey("/media/show");
		const item = {
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			sourceKey,
			path: "/media/show",
			name: "Show",
			title: "Show",
			files: [
				{
					name: "episode.mkv",
					path: "/media/show/episode.mkv",
					length: 100,
				},
			],
			length: 100,
			contentFingerprint: "same-fingerprint",
		};
		const firstScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			now: 1_000,
		});
		await env.inventory.upsertLibraryItems(firstScan.id, [item], {
			now: 1_100,
		});
		await env.inventory.completeLibraryScan(firstScan.id, { now: 1_200 });

		const secondScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			now: 2_000,
		});
		await env.inventory.upsertLibraryItems(secondScan.id, [item], {
			now: 2_100,
		});

		const row = await env
			.db("library_item")
			.where({ source_key: sourceKey })
			.first();
		const scan = await env.inventory.getLibraryScan(secondScan.id);

		expect(row).toMatchObject({
			first_seen_at: 1_100,
			last_seen_at: 2_100,
			last_indexed_at: 1_100,
			updated_at: 1_100,
			last_seen_scan_id: secondScan.id,
		});
		expect(scan).toMatchObject({
			itemsSeen: 1,
			itemsUpserted: 0,
			itemsRemoved: 0,
		});
	});

	it("syncs file rows and tombstones them with missing items", async () => {
		const sourceKey =
			env.inventory.createDataLibrarySourceKey("/media/show");
		const item = {
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			sourceKey,
			path: "/media/show",
			name: "Show",
			title: "Show",
			files: [
				{
					name: "episode.mkv",
					path: "show/episode.mkv",
					length: 100,
				},
			],
			length: 100,
		};

		const scan = await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			itemsToUpsert: [item],
			filesToUpsert: env.inventory.createLibraryFileInputs(item),
			pruneMissing: true,
			now: 1_000,
		});

		const fileRow = await env
			.db("library_file")
			.where({ item_source_key: sourceKey })
			.first();
		expect(fileRow).toMatchObject({
			source: env.inventory.LibraryItemSource.DATA,
			source_instance: "/media",
			path: "show/episode.mkv",
			name: "episode.mkv",
			length: 100,
			first_seen_at: 1_000,
			last_seen_at: 1_000,
			last_seen_scan_id: scan.id,
			missing_since: null,
		});

		const replacementScan = await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			itemsToUpsert: [
				{
					...item,
					files: [
						{
							name: "episode-2.mkv",
							path: "show/episode-2.mkv",
							length: 200,
						},
					],
					length: 200,
				},
			],
			filesToUpsert: env.inventory.createLibraryFileInputs({
				...item,
				files: [
					{
						name: "episode-2.mkv",
						path: "show/episode-2.mkv",
						length: 200,
					},
				],
				length: 200,
			}),
			now: 1_500,
		});

		const fileRowsAfterReplacement = await env
			.db("library_file")
			.where({ item_source_key: sourceKey })
			.orderBy("path");
		expect(fileRowsAfterReplacement).toHaveLength(2);
		expect(fileRowsAfterReplacement).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "show/episode.mkv",
					missing_since: 1_500,
				}),
				expect.objectContaining({
					path: "show/episode-2.mkv",
					length: 200,
					last_seen_scan_id: replacementScan.id,
					missing_since: null,
				}),
			]),
		);

		await env.inventory.markLibraryItemsMissingBySourceKeys([sourceKey], {
			now: 2_000,
		});

		const missingFileRow = await env
			.db("library_file")
			.where({ item_source_key: sourceKey })
			.first();
		expect(missingFileRow).toMatchObject({
			missing_since: 2_000,
			updated_at: 2_000,
		});
	});

	it("does not prune inventory from failed scans", async () => {
		const sourceKey =
			env.inventory.createDataLibrarySourceKey("/media/show");
		const firstScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			now: 1_000,
		});
		await env.inventory.upsertLibraryItems(
			firstScan.id,
			[
				{
					source: env.inventory.LibraryItemSource.DATA,
					sourceInstance: "/media",
					sourceKey,
					path: "/media/show",
					name: "Show",
					title: "Show",
					files: [],
					length: 0,
				},
			],
			{ now: 1_100 },
		);
		await env.inventory.completeLibraryScan(firstScan.id, { now: 1_200 });

		const failedScan = await env.inventory.beginLibraryScan({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			now: 2_000,
		});
		await env.inventory.failLibraryScan(failedScan.id, new Error("boom"), {
			now: 2_100,
		});

		await expect(
			env.inventory.pruneMissingLibraryItems(failedScan.id),
		).rejects.toThrow("Cannot prune library items for failed scan");

		const row = await env
			.db("library_item")
			.where({ source_key: sourceKey })
			.first();
		const scan = await env.inventory.getLibraryScan(failedScan.id);

		expect(row).toMatchObject({
			missing_since: null,
			last_seen_scan_id: firstScan.id,
		});
		expect(scan).toMatchObject({
			status: env.inventory.LibraryScanStatus.FAILED,
			error: "boom",
		});
	});

	it("dual writes client searchees and tombstones removed client items", async () => {
		await env.updateSearcheeClientDB(
			"client-a",
			[
				{
					infoHash: "hash-a",
					clientHost: "client-a",
					name: "Raw.Show.S01E01",
					title: "Parsed Show S01E01",
					files: [
						{
							name: "episode-a.mkv",
							path: "episode-a.mkv",
							length: 100,
						},
					],
					length: 100,
					savePath: "/downloads",
					category: "tv",
					tags: ["tag-a"],
					trackers: ["tracker-a"],
				},
				{
					infoHash: "hash-b",
					clientHost: "client-a",
					name: "Raw.Show.S01E02",
					title: "Parsed Show S01E02",
					files: [
						{
							name: "episode-b.mkv",
							path: "episode-b.mkv",
							length: 200,
						},
					],
					length: 200,
					savePath: "/downloads",
					category: "tv",
					tags: ["tag-b"],
					trackers: ["tracker-b"],
				},
			],
			new Set(["hash-a", "hash-b"]),
		);

		expect(await env.db("client_searchee")).toHaveLength(2);
		expect(
			await env.db("library_item").where({
				source: env.inventory.LibraryItemSource.CLIENT,
				source_instance: "client-a",
			}),
		).toHaveLength(2);

		await env.updateSearcheeClientDB(
			"client-a",
			[
				{
					infoHash: "hash-a",
					clientHost: "client-a",
					name: "Raw.Show.S01E01.Updated",
					title: "Parsed Show S01E01",
					files: [
						{
							name: "episode-a.mkv",
							path: "episode-a.mkv",
							length: 125,
						},
					],
					length: 125,
					savePath: "/downloads",
					category: "tv",
					tags: ["tag-a", "updated"],
					trackers: ["tracker-a"],
				},
			],
			new Set(["hash-a"]),
		);

		const activeRow = await env
			.db("library_item")
			.where({
				source_key: env.inventory.createClientLibrarySourceKey({
					clientHost: "client-a",
					infoHash: "hash-a",
				}),
			})
			.first();
		const removedRow = await env
			.db("library_item")
			.where({
				source_key: env.inventory.createClientLibrarySourceKey({
					clientHost: "client-a",
					infoHash: "hash-b",
				}),
			})
			.first();

		expect(await env.db("client_searchee")).toHaveLength(1);
		expect(activeRow).toMatchObject({
			name: "Raw.Show.S01E01.Updated",
			length: 125,
			missing_since: null,
		});
		expect(JSON.parse(activeRow!.tags!)).toEqual(["tag-a", "updated"]);
		expect(removedRow?.missing_since).toEqual(expect.any(Number));
	});
});
