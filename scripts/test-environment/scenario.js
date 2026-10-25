import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEnvironment, eventually } from "./daemon.js";
import {
	candidateHash,
	content,
	filename,
	sourceHash,
	startIndexer,
	startQbittorrent,
} from "./protocols.js";

/** Run the same observable workflow from automated tests or the manual demo. */
export async function runScenario(report = () => {}) {
	const env = await createEnvironment();
	let client;
	let indexer;
	try {
		await writeFile(join(env.dataDir, filename), content);
		client = await startQbittorrent(env.dataDir);
		indexer = await startIndexer();
		await env.start();
		assert.equal((await env.trpc("auth.authStatus")).userExists, false);
		await env.trpc(
			"auth.setup",
			{ username: "test-admin", password: "environment-test-password" },
			true,
		);
		assert.equal((await env.trpc("auth.authStatus")).isLoggedIn, true);
		report(
			"Fresh daemon initialized through HTTP; first user and session created",
		);

		const clientUrl = client.url.replace(
			"http://",
			"http://test:test-password@",
		);
		assert.equal(
			(
				await env.trpc(
					"clients.testConnection",
					{ client: "qbittorrent", url: clientUrl },
					true,
				)
			).success,
			true,
		);
		await env.trpc(
			"settings.save",
			{
				torrentClients: [`qbittorrent:${clientUrl}`],
				useClientTorrents: true,
				linkDirs: [env.linkDir],
				linkType: "hardlink",
				action: "inject",
				includeSingleEpisodes: true,
				searchCadence: 0,
				rssCadence: 0,
			},
			true,
		);
		const inventory = await eventually("client inventory", async () => {
			const result = await env.trpc("library.listItems", {
				includeFiles: true,
			});
			return result.items?.find((item) => item.infoHash === sourceHash);
		});
		assert.equal(inventory.fileCount, 1);
		assert.deepEqual(inventory.files, [
			{ name: filename, path: filename, length: content.length },
		]);
		assert.equal(inventory.length, content.length);
		report(
			"Real qBittorrent adapter indexed a completed synthetic torrent into Library",
		);

		await env.trpc(
			"indexers.create",
			{
				name: "Simulated Torznab",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		const search = await env.trpc(
			"library.bulkSearch",
			{ names: [filename], force: true },
			true,
		);
		assert.equal(search.attempted, 1);
		assert.equal(search.totalFound, 1);
		assert.equal(client.additions.length, 1);
		const addition = client.additions[0];
		assert.equal(addition.tags, "cross-seed");
		assert.equal(addition.category, "cross-seed-link");
		assert.equal(addition.stopped, "false");
		assert.ok(addition.savepath.startsWith(`${env.linkDir}/`));
		const linked = join(addition.savepath, filename);
		assert.deepEqual(await readFile(linked), content);
		const [originalStat, linkedStat] = await Promise.all([
			stat(join(env.dataDir, filename)),
			stat(linked),
		]);
		assert.equal(linkedStat.ino, originalStat.ino);
		assert.equal(linkedStat.dev, originalStat.dev);
		assert.ok(linkedStat.nlink >= 2);
		assert.ok(
			indexer.requests.some(
				(request) =>
					request.startsWith("/api?") && !request.includes("t=caps"),
			),
		);
		assert.ok(indexer.requests.includes("/candidate.torrent"));
		report(
			"HTTP search queried Torznab, downloaded real metainfo, hardlinked bytes, and injected through qBittorrent multipart API",
		);

		// Cause a real socket failure, then force an inventory refresh by re-saving
		// a source-affecting setting. The production adapter must retry successfully.
		const beforeSuccesses = client.successfulInfoRequests;
		const beforeScans = await env.trpc("library.getScanStatuses");
		const previousScanStart = beforeScans.find(
			(scan) => scan.source === "torrentClient",
		).startedAt;
		client.disconnectNextInfoRequest();
		const updated = await env.cli("config", "set", "--max-data-depth", "3");
		assert.match(updated.stderr, /Saved and applied by the running daemon/);
		assert.equal((await env.trpc("settings.get")).config.maxDataDepth, 3);
		await eventually(
			"inventory recovery after disconnected client request",
			async () => {
				const scans = await env.trpc("library.getScanStatuses");
				return (
					client.disconnections === 1 &&
					client.successfulInfoRequests > beforeSuccesses &&
					scans.some(
						(scan) =>
							scan.source === "torrentClient" &&
							scan.startedAt > previousScanStart &&
							scan.status === "succeeded" &&
							scan.activeItems === 2,
					)
				);
			},
		);
		report(
			"CLI change reached the running daemon; a dropped client connection was retried and inventory reconciled both torrents",
		);

		await env.stop();
		assert.equal(
			JSON.parse((await env.cli("config", "get", "maxDataDepth")).stdout),
			3,
		);
		const database = new DatabaseSync(
			join(env.configDir, "cross-seed.db"),
			{ readOnly: true },
		);
		let rows;
		try {
			assert.equal(
				database.prepare("PRAGMA integrity_check").get()
					.integrity_check,
				"ok",
			);
			rows = database
				.prepare(
					"SELECT id, source_key, info_hash FROM library_item ORDER BY id",
				)
				.all();
			assert.equal(rows.length, 2);
			assert.deepEqual(
				rows.map((row) => row.info_hash).sort(),
				[sourceHash, candidateHash].sort(),
			);
			assert.equal(
				database.prepare("SELECT COUNT(*) AS count FROM decision").get()
					.count,
				1,
			);
		} finally {
			database.close();
		}
		report(
			"Stopped daemon; SQLite integrity, two inventory rows, and persisted matching decision verified",
		);

		await env.start();
		assert.equal((await env.trpc("auth.authStatus")).isLoggedIn, true);
		const afterRestart = await env.trpc("library.listItems", {
			includeFiles: true,
		});
		assert.deepEqual(
			afterRestart.items.map((item) => item.id).sort(),
			rows.map((row) => row.id).sort(),
		);
		const repeated = await env.trpc(
			"library.bulkSearch",
			{ names: [filename], force: true },
			true,
		);
		assert.equal(repeated.totalFound, 0);
		assert.equal(client.additions.length, 1);
		assert.equal(client.torrents.size, 2);
		assert.deepEqual(await readFile(linked), content);
		assert.deepEqual(client.errors, []);
		assert.deepEqual(indexer.errors, []);
		report(
			"Restarted same database; session and inventory survived, repeat search caused no duplicate injection",
		);
		return {
			inventoryItems: 2,
			injections: client.additions.length,
			hardlinkVerified: true,
			restartVerified: true,
			clientDisconnectRecovered: true,
		};
	} catch (error) {
		throw new Error(`${error.message}\nDaemon output:\n${env.output}`, {
			cause: error,
		});
	} finally {
		await Promise.all([env.close(), client?.close(), indexer?.close()]);
	}
}
