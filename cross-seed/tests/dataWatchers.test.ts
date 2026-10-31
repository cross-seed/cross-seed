import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs")>()),
	watch,
}));

class FakeWatcher extends EventEmitter {
	close = vi.fn();
}

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-watchers-"));

describe.sequential("data directory watcher lifecycle", () => {
	let db: typeof import("../src/db.js").db;
	let dataFiles: typeof import("../src/dataFiles.js");
	let logger: typeof import("../src/logger.js").logger;
	let runtime: typeof import("../src/runtimeConfig.js");
	let created: FakeWatcher[];

	beforeEach(async () => {
		process.env.CONFIG_DIR = await mkdtemp(join(TEST_ROOT, "config-"));
		vi.resetModules();
		created = [];
		watch.mockReset().mockImplementation(() => {
			const watcher = new FakeWatcher();
			created.push(watcher);
			return watcher;
		});
		({ db } = await import("../src/db.js"));
		const config = await import("../src/configuration.js");
		runtime = await import("../src/runtimeConfig.js");
		dataFiles = await import("../src/dataFiles.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		await db.migrate.latest();
		runtime.setRuntimeConfig({
			...config.getDefaultRuntimeConfig(),
			dataDirs: [await mkdtemp(join(TEST_ROOT, "data-"))],
			useClientTorrents: false,
		});
	});

	afterEach(async () => {
		dataFiles.destroyDataDirWatchers();
		vi.useRealTimers();
		logger.close();
		await db.destroy();
		delete process.env.CONFIG_DIR;
	});

	it("closes old watchers on reindex and when dataDirs are removed", async () => {
		await dataFiles.indexDataDirs({ startup: true });
		await dataFiles.indexDataDirs({ startup: true });
		expect(created).toHaveLength(2);
		expect(created[0].close).toHaveBeenCalledOnce();
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			dataDirs: [],
		});
		await dataFiles.indexDataDirs({ startup: true });
		expect(created[1].close).toHaveBeenCalledOnce();
	});

	it("ignores linked-file watcher events but refreshes ordinary source changes", async () => {
		const dataDir = runtime.getRuntimeConfig().dataDirs[0];
		const links = join(dataDir, "links");
		await mkdir(links);
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			linkDirs: [links],
		});
		await dataFiles.indexDataDirs({ startup: true });
		const before = await db("library_scan").count({ count: "*" }).first();
		const callback = watch.mock.calls[0][2] as (
			event: string,
			filename: string,
		) => void;
		await writeFile(join(links, "Linked.S01E01.mkv"), "linked");
		callback("rename", "links/Linked.S01E01.mkv");
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
		await dataFiles.indexDataDirs({ startup: false });
		expect(await db("library_scan").count({ count: "*" }).first()).toEqual(
			before,
		);
		const original = join(dataDir, "Original.S01E01.mkv");
		await writeFile(original, "original");
		callback("rename", "Original.S01E01.mkv");
		clock.mockReturnValue(now + 122_000);
		await dataFiles.indexDataDirs({ startup: false });
		expect(await db("data").where({ path: original })).toHaveLength(1);
		expect(
			await db("data").where({ path: join(links, "Linked.S01E01.mkv") }),
		).toHaveLength(0);
		clock.mockRestore();
	});
	it("delays retries and cancels pending retries on cleanup", async () => {
		await dataFiles.indexDataDirs({ startup: true });
		vi.useFakeTimers();
		created[0].emit("error", new Error("EMFILE"));
		expect(created[0].close).toHaveBeenCalledOnce();
		expect(watch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(watch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(watch).toHaveBeenCalledTimes(2);
		created[1].emit("error", new Error("EMFILE"));
		dataFiles.destroyDataDirWatchers();
		await vi.advanceTimersByTimeAsync(5000);
		expect(watch).toHaveBeenCalledTimes(2);
		// A queued error from a closed watcher must not restart it.
		created[1].emit("error", new Error("late error"));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("continues indexing when watcher creation throws", async () => {
		watch.mockImplementationOnce(() => {
			throw new Error("EMFILE");
		});
		await expect(
			dataFiles.indexDataDirs({ startup: true }),
		).resolves.toBeUndefined();
		expect(watch).toHaveBeenCalledOnce();
	});
	it("rescans files changed while watcher is disconnected", async () => {
		const deletedPath = join(
			runtime.getRuntimeConfig().dataDirs[0],
			"Deleted.Show.S01E01.mkv",
		);
		await writeFile(deletedPath, Buffer.alloc(100));
		let recovery: Promise<void> | undefined;
		const onWatcherRecovery = vi.fn(() => {
			recovery = dataFiles.indexDataDirs({ startup: false });
			return recovery;
		});
		await dataFiles.indexDataDirs({ startup: true, onWatcherRecovery });
		expect(onWatcherRecovery).not.toHaveBeenCalled();
		vi.useFakeTimers();
		created[0].emit("error", new Error("EMFILE"));
		await unlink(deletedPath);
		const path = join(
			runtime.getRuntimeConfig().dataDirs[0],
			"Missed.Show.S01E01.mkv",
		);
		await writeFile(path, Buffer.alloc(100));
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();
		await recovery;
		expect(onWatcherRecovery).toHaveBeenCalledOnce();
		expect(
			await db("library_item").where({ path }).whereNull("missing_since"),
		).toHaveLength(1);
		expect(
			await db("library_item")
				.where({ path: deletedPath })
				.whereNull("missing_since"),
		).toHaveLength(0);
	});
	it("retains a recovery request that arrives during a full scan", async () => {
		const inventory = await import("../src/libraryInventory.js");
		const begin = inventory.beginLibraryScan;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const scans = vi
			.spyOn(inventory, "beginLibraryScan")
			.mockImplementationOnce(async (options) => {
				await gate;
				return begin(options);
			});
		const { indexTorrentsAndDataDirs } = await import("../src/torrent.js");
		const running = indexTorrentsAndDataDirs({ startup: true });
		await vi.waitFor(() => expect(scans).toHaveBeenCalledOnce());
		vi.useFakeTimers();
		created[0].emit("error", new Error("EMFILE"));
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();
		release();
		await running;
		expect(scans).toHaveBeenCalledTimes(2);
		scans.mockRestore();
	});

	it("automatically indexes a returning directory using a real filesystem watcher", async () => {
		const realFs = await vi.importActual<typeof import("fs")>("fs");
		watch.mockImplementation(realFs.watch);
		const dataDir = join(TEST_ROOT, `returning-${Date.now()}`);
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			dataDirs: [dataDir],
			torznab: [],
		});
		const { indexTorrentsAndDataDirs } = await import("../src/torrent.js");
		await indexTorrentsAndDataDirs({ startup: true });
		await mkdir(dataDir);
		const path = join(dataDir, "Recovered.Show.S01E01.mkv");
		await writeFile(path, Buffer.alloc(100));
		await vi.waitFor(
			async () => {
				expect(
					await db("library_item")
						.where({ path })
						.whereNull("missing_since"),
				).toHaveLength(1);
			},
			{ timeout: 5000 },
		);
		await indexTorrentsAndDataDirs(); // Drain any remaining work before teardown.
	});

	it("throttles retry errors and cancels recovery when the source is removed", async () => {
		const error = vi.spyOn(logger, "error");
		watch.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		const onWatcherRecovery = vi.fn().mockResolvedValue(undefined);
		vi.useFakeTimers();
		await dataFiles.indexDataDirs({ startup: true, onWatcherRecovery });
		await vi.advanceTimersByTimeAsync(59_000);
		expect(watch).toHaveBeenCalledTimes(60);
		expect(
			error.mock.calls.filter((call) => {
				const message: unknown = call[0];
				return (
					typeof message === "string" &&
					message.startsWith("Retrying watcher")
				);
			}),
		).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(
			error.mock.calls.filter((call) => {
				const message: unknown = call[0];
				return (
					typeof message === "string" &&
					message.startsWith("Retrying watcher")
				);
			}),
		).toHaveLength(2);
		dataFiles.destroyDataDirWatchers();
		watch.mockImplementation(() => new FakeWatcher());
		await vi.advanceTimersByTimeAsync(5000);
		expect(onWatcherRecovery).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		error.mockRestore();
	});
});
