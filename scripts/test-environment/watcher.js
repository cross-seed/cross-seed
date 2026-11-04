import assert from "node:assert/strict";
import { chmod, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEnvironment, eventually } from "./daemon.js";

/** Run as a non-root Linux user: root bypasses the permission failure. */
export async function runWatcherScenario(report = () => {}, options = {}) {
	const env = await createEnvironment(options);
	const child = join(env.dataDir, "child");
	const original = "Fictional.Show.S01E01.mkv";
	const recovered = "Recovered.Show.S01E01.mkv";
	const healthy = "Healthy.Show.S01E01.mkv";
	const items = async () =>
		(await env.trpc("library.listItems", { includeFiles: true })).items;
	const has = async (filename) =>
		(await items()).some(
			(item) =>
				item.name === filename ||
				item.files?.some((file) => file.name === filename),
		);
	try {
		await mkdir(child);
		await writeFile(join(child, original), Buffer.alloc(100));
		await env.start();
		await env.trpc(
			"auth.setup",
			{ username: "watcher-admin", password: "watcher-test-password" },
			true,
		);
		await env.trpc(
			"settings.save",
			{
				action: "save",
				useClientTorrents: false,
				searchCadence: 0,
				rssCadence: 0,
				dataDirs: [env.dataDir, env.linkDir],
			},
			true,
		);
		await eventually("initial source inventory", () => has(original));
		const initial = await items();
		await chmod(child, 0);
		await utimes(child, new Date(), new Date());
		await eventually("contained watcher error", () =>
			env.output.includes("Retrying watcher for dataDir"),
		);
		assert.equal((await env.request("/api/ping")).status, 200);
		report(
			"Recursive watcher exception was contained; daemon HTTP remains available",
		);
		await writeFile(join(env.linkDir, healthy), Buffer.alloc(100));
		await env.trpc("settings.save", { maxDataDepth: 3 }, true);
		await eventually("healthy source inventory during outage", () =>
			has(healthy),
		);
		const preserved = await items();
		for (const item of initial)
			assert.ok(preserved.some((current) => current.id === item.id));
		report(
			"Failed source kept its inventory while the healthy source continued indexing",
		);
		await chmod(child, 0o755);
		await writeFile(join(child, recovered), Buffer.alloc(100));
		await eventually("watcher recovery and automatic rescan", () =>
			has(recovered),
		);
		report(
			"Restored permissions reattached the watcher and indexed files missed during the outage",
		);
		await rm(child, { recursive: true });
		assert.equal((await env.request("/api/ping")).status, 200);
		await env.stop();
		assert.ok(!env.output.includes("Unhandled"));
		report(
			"Directory deletion and shutdown completed without a daemon crash or teardown error",
		);
	} finally {
		await chmod(child, 0o755).catch(() => {});
		await env.close();
	}
}
