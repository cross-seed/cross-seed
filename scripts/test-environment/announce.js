import assert from "node:assert/strict";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEnvironment, eventually } from "./daemon.js";
import {
	candidateHash,
	content,
	filename,
	release,
	sourceHash,
	startIndexer,
	startQbittorrent,
} from "./protocols.js";

async function runCase(mode, report) {
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
			{ username: "announce-admin", password: "announce-test-password" },
			true,
		);
		await env.trpc(
			"settings.save",
			{
				torrentClients: [
					`qbittorrent:${client.url.replace("http://", "http://test:test-password@")}`,
				],
				useClientTorrents: true,
				action: "save",
				includeSingleEpisodes: true,
				searchCadence: 0,
				rssCadence: 0,
			},
			true,
		);
		await eventually("source inventory", async () => {
			const { items } = await env.trpc("library.listItems", {});
			return items.some((item) => item.infoHash === sourceHash);
		});
		const { config } = await env.trpc("settings.get");
		const link = `${indexer.url}/candidate.torrent`;
		const guid =
			mode === "omitted"
				? undefined
				: mode === "url"
					? `${indexer.url}/details/1`
					: "simulated-tracker/torrent/1";
		const identity = guid ?? link;
		const payload = {
			name: release,
			link,
			tracker: "Simulated Torznab",
			...(guid === undefined ? {} : { guid }),
		};
		async function announce(input) {
			// Exercise streamed JSON and form bodies through the actual Node adapter.
			const form = mode === "opaque";
			const bytes = new TextEncoder().encode(
				form
					? new URLSearchParams(input).toString()
					: JSON.stringify(input),
			);
			const response = await env.request("/api/announce", {
				method: "POST",
				headers: {
					"x-api-key": config.apiKey,
					"content-type": form
						? "application/x-www-form-urlencoded"
						: "application/json",
				},
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(bytes.subarray(0, 20));
						controller.enqueue(bytes.subarray(20));
						controller.close();
					},
				}),
				duplex: "half",
			});
			assert.equal(response.status, 200, await response.text());
		}
		const cachePath = join(
			env.configDir,
			"torrent_cache",
			`${candidateHash}.cached.torrent`,
		);
		async function savedCopy() {
			const files = (await readdir(config.outputDir)).filter((name) =>
				name.endsWith(".torrent"),
			);
			assert.equal(files.length, 1);
			const saved = join(config.outputDir, files[0]);
			assert.deepEqual(await readFile(saved), await readFile(cachePath));
			return saved;
		}

		await announce(payload);
		await unlink(await savedCopy());
		const retry = {
			...payload,
			guid: identity,
			link: `${indexer.url}/unavailable-download`,
		};
		await announce(retry);
		await unlink(await savedCopy());
		await env.stop();
		const database = new DatabaseSync(
			join(env.configDir, "cross-seed.db"),
			{
				readOnly: true,
			},
		);
		try {
			const decisions = database
				.prepare("SELECT guid, info_hash FROM decision")
				.all();
			assert.equal(decisions.length, 1);
			assert.equal(decisions[0].guid, identity);
			assert.equal(decisions[0].info_hash, candidateHash);
		} finally {
			database.close();
		}
		await env.start();
		await announce(retry);
		await savedCopy();
		assert.deepEqual(indexer.requests, ["/candidate.torrent"]);
		assert.equal(client.additions.length, 0);
		assert.deepEqual(client.errors, []);
		assert.deepEqual(indexer.errors, []);
		report(
			`Announce guid ${mode}: downloaded link, persisted identity, and recreated saved metainfo from cache with an unavailable download URL before and after restart`,
		);
	} catch (error) {
		throw new Error(`${mode}: ${error.message}\n${env.output}`, {
			cause: error,
		});
	} finally {
		await Promise.all([env.close(), client?.close(), indexer?.close()]);
	}
}

export async function runAnnounceScenario(report = () => {}) {
	for (const mode of ["omitted", "url", "opaque"]) {
		await runCase(mode, report);
	}
}
