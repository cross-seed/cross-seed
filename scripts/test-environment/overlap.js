import { createServer } from "node:http";
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
	const notifications = [];
	const webhook = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		notifications.push(JSON.parse(body));
		response.writeHead(200).end("ok");
	});
	try {
		await writeFile(join(env.dataDir, filename), content);
		client = await startQbittorrent(env.dataDir);
		indexer = await startIndexer();
		await env.start();
		await new Promise((resolve) => webhook.listen(0, "127.0.0.1", resolve));
		await env.trpc(
			"auth.setup",
			{
				username: "overlap-admin",
				password: "environment-test-password",
			},
			true,
		);
		await assert.rejects(
			env.trpc(
				"settings.save",
				{ dataDirs: [env.dataDir], linkDirs: [env.dataDir] },
				true,
			),
			/must differ/,
		);
		assert.deepEqual((await env.trpc("settings.get")).config.dataDirs, []);
		report(
			"Exact shared root rejected before persistence; previous settings preserved",
		);
		const linkDir = join(env.dataDir, "links");
		await mkdir(linkDir);
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
				notificationWebhookUrls: [
					`http://127.0.0.1:${webhook.address().port}/notify`,
				],
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
		await eventually("live notifier", () =>
			notifications.some(
				(notification) => notification.extra?.event === "RESULTS",
			),
		);
		const addition = client.additions[0];
		assert.ok(addition.savepath.startsWith(linkDir + "/"));
		const linked = join(addition.savepath, filename);
		assert.deepEqual(await readFile(linked), content);
		assert.equal(
			(await stat(linked)).ino,
			(await stat(join(env.dataDir, filename))).ino,
		);
		report(
			"Nested roots: HTTP search hardlinked and injected into the configured destination; live webhook received RESULTS",
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
		await env.stop();
		await env.start();
		const items = (await env.trpc("library.listItems")).items;
		assert.ok(
			items.some((item) => item.path === join(env.dataDir, filename)),
		);
		assert.ok(items.every((item) => !item.path?.startsWith(linkDir)));
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
		await Promise.all([
			env.close(),
			client?.close(),
			indexer?.close(),
			new Promise((resolve) => webhook.close(resolve)),
		]);
	}
}
