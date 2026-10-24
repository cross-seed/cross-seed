import { EventEmitter } from "node:events";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
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
		await dataFiles.indexDataDirs({ startup: true });
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
		await dataFiles.indexDataDirs({ startup: false });
		expect(
			await db("library_item").where({ path }).whereNull("missing_since"),
		).toHaveLength(1);
		expect(
			await db("library_item")
				.where({ path: deletedPath })
				.whereNull("missing_since"),
		).toHaveLength(0);
	});
});
