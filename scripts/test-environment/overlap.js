import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEnvironment, eventually } from "./daemon.js";
import {
	content,
	filename,
	startIndexer,
	startQbittorrent,
} from "./protocols.js";

/** Exercise actual linking and HTTP-triggered rescans with overlapping roots. */
export async function runOverlapScenario(report = () => {}) {
	const env = await createEnvironment();
	let client;
	let indexer;
	try {
		await writeFile(join(env.dataDir, filename), content);
		client = await startQbittorrent(env.dataDir);
		indexer = await startIndexer();
		await env.start();
		await env.trpc(
			"auth.setup",
			{
				username: "overlap-admin",
				password: "environment-test-password",
			},
			true,
		);
		const linkDir = env.dataDir;
		await env.trpc(
			"settings.save",
			{
				dataDirs: [env.dataDir],
				linkDirs: [linkDir],
				maxDataDepth: 4,
				torrentClients: [
					`qbittorrent:${client.url.replace("http://", "http://test:test-password@")}`,
				],
				useClientTorrents: false,
				action: "inject",
				linkType: "hardlink",
				includeSingleEpisodes: true,
				searchCadence: 0,
				rssCadence: 0,
			},
			true,
		);
		await eventually("original data inventory", async () =>
			(await env.trpc("library.listItems")).items?.some(
				(item) => item.path === join(env.dataDir, filename),
			),
		);
		await env.trpc(
			"indexers.create",
			{
				name: "Overlap Torznab",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		const result = await env.trpc(
			"library.bulkSearch",
			{ names: [filename], force: true },
			true,
		);
		assert.equal(result.totalFound, 1);
		assert.equal(client.additions.length, 1);
		const addition = client.additions[0];
		assert.ok(
			addition.savepath.startsWith(
				join(linkDir, ".cross-seed-links") + "/",
			),
		);
		const linked = join(addition.savepath, filename);
		assert.deepEqual(await readFile(linked), content);
		assert.equal(
			(await stat(linked)).ino,
			(await stat(join(env.dataDir, filename))).ino,
		);
		report(
			"Shared link/data root: HTTP search injected a real hardlink into the automatic subfolder",
		);
		// Re-save through HTTP so the daemon must apply its new source policy live.
		await env.trpc("settings.save", { maxDataDepth: 3 }, true);
		await eventually("rescan excludes generated link", async () => {
			const scans = await env.trpc("library.getScanStatuses");
			const items = (
				await env.trpc("library.listItems", { includeFiles: true })
			).items;
			return (
				scans.some(
					(scan) =>
						scan.source === "dataDir" &&
						scan.status === "succeeded",
				) &&
				items.length === 1 &&
				items[0].path === join(env.dataDir, filename)
			);
		});
		// A dedicated nested link root can change live without removing originals.
		const nested = join(env.dataDir, "nested-links");
		await mkdir(nested);
		await writeFile(join(nested, "Generated.S01E01.mkv"), "generated");
		await env.trpc("settings.save", { linkDirs: [nested] }, true);
		await eventually("nested link policy", async () => {
			const items = (await env.trpc("library.listItems")).items;
			return (
				items.length >= 1 &&
				items.every((item) => !item.path?.startsWith(nested))
			);
		});
		await env.stop();
		await env.start();
		const items = (await env.trpc("library.listItems")).items;
		assert.ok(
			items.some((item) => item.path === join(env.dataDir, filename)),
		);
		assert.ok(items.every((item) => !item.path?.startsWith(nested)));
		assert.deepEqual(await readFile(linked), content);
		assert.deepEqual(client.errors, []);
		assert.deepEqual(indexer.errors, []);
		report(
			"Live nested-directory exclusion survived restart; originals and linked bytes remain intact",
		);
	} catch (error) {
		throw new Error(`${error.message}\nDaemon output:\n${env.output}`, {
			cause: error,
		});
	} finally {
		await Promise.all([env.close(), client?.close(), indexer?.close()]);
	}
}
