import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	watchDataDir,
	watchDataDirInWorker,
	type DataDirWatcher,
} from "../src/dataDirWatcher.js";

let directory: string;
let watcher: DataDirWatcher | undefined;
afterEach(async () => {
	await watcher?.close();
	watcher = undefined;
	if (directory) {
		await chmod(join(directory, "child"), 0o755).catch(() => {});
		await rm(directory, { recursive: true, force: true });
	}
});

it("installs recursive watches before readiness and drains the worker on close", async () => {
	directory = await mkdtemp(join(tmpdir(), "data-dir-worker-"));
	await mkdir(join(directory, "child"));
	const changed = vi.fn<(filename: string | null) => void>();
	watcher = watchDataDirInWorker(directory, changed);
	const errors = vi.fn();
	watcher.on("error", errors);
	await watcher.ready;
	await writeFile(join(directory, "child", "episode.mkv"), "test");
	await vi.waitFor(
		() =>
			expect(
				changed.mock.calls.some(([path]) =>
					path?.endsWith("episode.mkv"),
				),
			).toBe(true),
		{ timeout: 3000 },
	);
	expect(errors).not.toHaveBeenCalled();
	await watcher.close();
	const count = changed.mock.calls.length;
	await writeFile(join(directory, "child", "after-close.mkv"), "test");
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(changed).toHaveBeenCalledTimes(count);
	expect(watcher.closed).toBe(true);
});

it("reports failed worker startup as a recoverable error instead of crashing the parent", async () => {
	directory = await mkdtemp(join(tmpdir(), "data-dir-worker-missing-"));
	watcher = watchDataDirInWorker(join(directory, "missing"), () => {});
	const errors = vi.fn();
	watcher.on("error", errors);
	await expect(watcher.ready).rejects.toThrow(/ENOENT/);
	expect(errors).toHaveBeenCalled();
	await watcher.close();
});

it("can close during startup without producing errors or leaking a worker", async () => {
	directory = await mkdtemp(join(tmpdir(), "data-dir-worker-close-"));
	watcher = watchDataDirInWorker(directory, () => {});
	const errors = vi.fn();
	watcher.on("error", errors);
	const first = watcher.close();
	expect(watcher.close()).toBe(first);
	await first;
	await expect(watcher.ready).rejects.toThrow(/closed/);
	expect(errors).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
	"contains recursive fs.watch EACCES thrown outside its error listener",
	async () => {
		directory = await mkdtemp(join(tmpdir(), "data-dir-worker-eacces-"));
		const child = join(directory, "child");
		await mkdir(child);
		watcher = watchDataDir(directory, () => {});
		const errors = vi.fn();
		watcher.on("error", errors);
		await watcher.ready;
		await chmod(child, 0);
		await utimes(child, new Date(), new Date());
		await vi.waitFor(() => expect(errors).toHaveBeenCalled(), {
			timeout: 3000,
		});
		expect(String(errors.mock.calls[0][0])).toMatch(/EACCES/);
		// Reaching this assertion proves the exception only terminated the worker.
		await watcher.close();
	},
);
