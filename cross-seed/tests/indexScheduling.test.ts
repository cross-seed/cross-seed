import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-index-scheduling-"));

describe.sequential("indexing scheduling", () => {
	let db: typeof import("../src/db.js").db;
	let torrent: typeof import("../src/torrent.js");
	let dataFiles: typeof import("../src/dataFiles.js");
	let logger: typeof import("../src/logger.js").logger;

	beforeEach(async () => {
		process.env.CONFIG_DIR = await mkdtemp(join(TEST_ROOT, "config-"));
		vi.resetModules();
		({ db } = await import("../src/db.js"));
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
		setRuntimeConfig({
			...config.getDefaultRuntimeConfig(),
			useClientTorrents: false,
		});
		await db.migrate.latest();
		dataFiles = await import("../src/dataFiles.js");
		torrent = await import("../src/torrent.js");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		dataFiles.destroyDataDirWatchers();
		logger.close();
		await db.destroy();
		delete process.env.CONFIG_DIR;
	});

	it("coalesces source changes and keeps cleanup behind the active scan", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const index = vi
			.spyOn(dataFiles, "indexDataDirs")
			.mockImplementationOnce(() => gate)
			.mockResolvedValue(undefined);
		await db("data").insert({ path: "/old/item.mkv", title: "old" });
		const running = torrent.indexTorrentsAndDataDirs();
		expect(index).toHaveBeenCalledOnce();
		const refresh = torrent.indexTorrentsAndDataDirs({ startup: true });
		const anotherRefresh = torrent.indexTorrentsAndDataDirs({
			startup: true,
		});
		expect(refresh).toBe(running);
		expect(anotherRefresh).toBe(running);
		expect(await db("data")).toHaveLength(1);
		release();
		await refresh;
		expect(index.mock.calls.map(([options]) => options.startup)).toEqual([
			false,
			true,
		]);
		expect(await db("data")).toHaveLength(0);
	});

	it("coalesces watcher recovery behind an active scan without startup cleanup", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const index = vi
			.spyOn(dataFiles, "indexDataDirs")
			.mockImplementationOnce(() => gate)
			.mockResolvedValue(undefined);
		const running = torrent.indexTorrentsAndDataDirs();
		const recovery = index.mock.calls[0][0].onWatcherRecovery!;
		expect(recovery()).toBe(running);
		expect(recovery()).toBe(running);
		expect(index).toHaveBeenCalledOnce();
		release();
		await running;
		expect(index.mock.calls.map(([options]) => options.startup)).toEqual([
			false,
			false,
		]);
	});

	it("runs a queued refresh even when the active startup scan fails", async () => {
		let reject!: (error: Error) => void;
		const gate = new Promise<void>((_resolve, rejectPromise) => {
			reject = rejectPromise;
		});
		const index = vi
			.spyOn(dataFiles, "indexDataDirs")
			.mockImplementationOnce(() => gate)
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockResolvedValue(undefined);
		const running = torrent.indexTorrentsAndDataDirs({ startup: true });
		await vi.waitFor(() => expect(index).toHaveBeenCalledOnce());
		const refresh = torrent.indexTorrentsAndDataDirs({ startup: true });
		reject(new Error("unavailable"));
		await expect(running).resolves.toBeUndefined();
		await refresh;
		expect(index).toHaveBeenCalledTimes(4);
	});
	it.each([undefined, "/new/torrents"])(
		"changing torrentDir to %s cleans ensemble entries",
		async (torrentDir) => {
			const { getRuntimeConfig, setRuntimeConfig } =
				await import("../src/runtimeConfig.js");
			setRuntimeConfig({ ...getRuntimeConfig(), torrentDir });
			const { syncLibraryItems, LibraryItemSource } =
				await import("../src/libraryInventory.js");
			const { indexTorrentsAndDataDirs } =
				await import("../src/torrent.js");
			const infoHash = "a".repeat(40);
			await syncLibraryItems({
				source: LibraryItemSource.TORRENT,
				sourceInstance: "/old/torrents",
				itemsToUpsert: [
					{
						source: LibraryItemSource.TORRENT,
						sourceInstance: "/old/torrents",
						sourceKey: "torrentFile:/old/torrents/item.torrent",
						path: "/old/torrents/item.torrent",
						infoHash,
						title: "Old",
						name: "Old",
						files: [],
						length: 1,
					},
				],
			});
			await db("ensemble").insert({
				client_host: null,
				path: "/data/old.mkv",
				info_hash: infoHash,
				ensemble: "old.s1",
				element: "1",
			});
			await indexTorrentsAndDataDirs({ startup: true });
			expect(
				await db("library_item").whereNull("missing_since"),
			).toHaveLength(0);
			expect(
				await db("ensemble").where({ info_hash: infoHash }),
			).toHaveLength(0);
		},
	);
});
