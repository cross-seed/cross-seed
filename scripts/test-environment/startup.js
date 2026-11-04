import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEnvironment, eventually } from "./daemon.js";
import { startIndexer } from "./protocols.js";

export async function runStartupScenario(report = () => {}) {
	const env = await createEnvironment();
	const indexer = await startIndexer();
	const saved = () => {
		const db = new DatabaseSync(join(env.configDir, "cross-seed.db"), {
			readOnly: true,
		});
		try {
			return db.prepare("SELECT settings_json FROM settings").get()
				.settings_json;
		} finally {
			db.close();
		}
	};
	try {
		await env.start();
		await env.trpc(
			"auth.setup",
			{ username: "startup-admin", password: "startup-test-password" },
			true,
		);
		await env.trpc(
			"settings.save",
			{
				basePath: "/saved",
				verbose: true,
				useClientTorrents: false,
				action: "save",
				searchCadence: 0,
				rssCadence: 0,
			},
			true,
		);
		await env.stop();
		const before = saved();
		await env.start({ basePath: "/saved" });
		assert.equal((await env.trpc("settings.get")).config.verbose, true);
		assert.equal(
			(await env.trpc("settings.get")).config.basePath,
			"/saved",
		);
		await env.trpc(
			"indexers.create",
			{
				name: "saved-verbosity-marker",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		await eventually("saved verbosity on stdout", () =>
			env.output.includes("Created indexer: saved-verbosity-marker"),
		);
		await env.stop();
		assert.equal(saved(), before);
		report(
			"Ordinary restart honors saved base path and verbose console output without rewriting settings",
		);
		// A deliberately empty prefix is an explicit override, not an absent flag.
		await env.start({ args: ["--base-path", ""] });
		await env.trpc(
			"indexers.create",
			{
				name: "second-verbosity-marker",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		await eventually("verbose output on second restart", () =>
			env.output.includes("Created indexer: second-verbosity-marker"),
		);
		await env.stop();
		assert.equal(saved(), before);
		// Explicit verbose=true must override a saved false value for this run only.
		await env.cli("config", "set", "--verbose", "false");
		const quiet = saved();
		await env.start({ basePath: "/saved" });
		await env.trpc(
			"indexers.create",
			{
				name: "quiet-verbosity-marker",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		await env.stop();
		assert.ok(
			!env.output.includes("Created indexer: quiet-verbosity-marker"),
		);
		await env.start({
			basePath: "/override",
			args: ["--base-path", "/override", "--verbose"],
		});
		await env.trpc(
			"indexers.create",
			{
				name: "explicit-verbosity-marker",
				url: `${indexer.url}/api`,
				apikey: "simulated-indexer-key",
			},
			true,
		);
		await eventually("explicit verbose output", () =>
			env.output.includes("Created indexer: explicit-verbosity-marker"),
		);
		await env.stop();
		assert.equal(saved(), quiet);
		report(
			"Explicit empty/custom base-path and verbose flags affect only the invocation",
		);
		await assert.rejects(env.cli("daemon", "--no-port"), (error) =>
			/unknown option '--no-port'/.test(error.stderr),
		);
		await assert.rejects(env.cli("daemon", "--port", "0"));
		assert.equal(saved(), quiet);
		report(
			"Removed --no-port and invalid zero port fail without changing persisted settings",
		);
	} finally {
		await env.close();
		await indexer.close();
	}
}
