import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createEnvironment, eventually } from "./daemon.js";

export async function runRecoveryScenario(report = () => {}) {
	const env = await createEnvironment();
	const database = join(env.configDir, "cross-seed.db");
	function readSettings() {
		const db = new DatabaseSync(database, { readOnly: true });
		try {
			return db.prepare("SELECT * FROM settings").get();
		} finally {
			db.close();
		}
	}
	function replaceRaw(json, legacyKey = null) {
		const db = new DatabaseSync(database);
		try {
			db.prepare("UPDATE settings SET settings_json = ?, apikey = ?").run(
				json,
				legacyKey,
			);
		} finally {
			db.close();
		}
	}
	async function rejected(procedure, input, status = 412) {
		const response = await env.request(`/api/trpc/${procedure}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		assert.equal(response.status, status, await response.text());
	}
	try {
		await env.start();
		await env.trpc(
			"auth.setup",
			{ username: "recovery-admin", password: "recovery-test-password" },
			true,
		);
		const apiKey = (await env.trpc("settings.get")).apiKey;
		await env.trpc(
			"settings.save",
			{
				basePath: "/recovery",
				action: "save",
				useClientTorrents: false,
				searchCadence: 0,
				rssCadence: 0,
			},
			true,
		);
		await env.stop();
		const valid = JSON.parse(readSettings().settings_json);
		await writeFile(
			join(env.dataDir, "Recovery.Movie.2026.1080p.WEB-DL-GROUP.mkv"),
			Buffer.alloc(1024),
		);
		replaceRaw(
			JSON.stringify({
				...valid,
				dataDirs: [env.dataDir],
				linkDirs: [env.dataDir],
			}),
		);
		const before = readSettings();
		await env.start({ basePath: "/recovery" });
		assert.equal(
			(
				await env.request("/settings/directories", {
					headers: { accept: "text/html" },
				})
			).status,
			200,
		);
		const unauthorized = await fetch(
			new URL(
				"/recovery/api/trpc/settings.recovery",
				(await env.request("/api/ping")).url,
			),
		);
		assert.equal(unauthorized.status, 401);
		assert.equal(
			(await env.trpc("settings.recovery")).useJsonEditor,
			false,
		);
		assert.deepEqual((await env.trpc("settings.get")).config.linkDirs, [
			env.dataDir,
		]);
		assert.equal(
			(await env.trpc("health.get")).problems[0].id,
			"daemon:recovery",
		);
		for (const path of ["announce", "webhook", "job"]) {
			const response = await env.request(`/api/${path}`, {
				method: "POST",
				headers: {
					"x-api-key": apiKey,
					"content-type": "application/json",
				},
				body: "{}",
			});
			assert.equal(response.status, 503, await response.text());
		}
		assert.equal(
			(
				await env.request("/api/status", {
					headers: { "x-api-key": apiKey },
				})
			).status,
			503,
		);
		await rejected("library.bulkSearch", { names: ["Recovery.Movie"] });
		await rejected("jobs.triggerJob", { name: "cleanup" });
		await rejected("settings.save", { linkDirs: [env.dataDir] }, 500);
		await delay(1500); // Cross the ordinary deferred-start boundary.
		assert.deepEqual(readSettings(), before);
		assert.ok(!env.output.includes("starting job:"));
		report(
			"Invalid directory layout serves authenticated Settings/Health, blocks work, and preserves failed repairs and the API key",
		);
		await env.trpc("settings.save", { linkDirs: [env.linkDir] }, true);
		assert.equal(await env.trpc("settings.recovery"), null);
		await eventually(
			"indexing after repair",
			async () =>
				(await env.trpc("library.listItems", {})).items.length === 1,
		);
		assert.equal((await env.trpc("settings.get")).apiKey, apiKey);
		await env.stop();
		await env.start({ basePath: "/recovery" });
		assert.equal(await env.trpc("settings.recovery"), null);
		await env.stop();
		report(
			"A valid Web UI settings save resumes indexing automatically and survives restart",
		);
		for (const [json, legacyKey] of [
			[JSON.stringify({ ...valid, delay: 1 }), apiKey],
			["{broken", apiKey],
			["{broken", null],
		]) {
			replaceRaw(json, legacyKey);
			const original = readSettings();
			await env.start({
				basePath: "/recovery",
				args: ["--base-path", "/recovery"],
			});
			const recovery = await env.trpc("settings.recovery");
			assert.equal(recovery.useJsonEditor, true);
			assert.equal(recovery.rawSettings, json);
			assert.equal(
				(
					await env.request("/api/status", {
						headers: { "x-api-key": apiKey },
					})
				).status,
				legacyKey ? 503 : 401,
			);
			await rejected("settings.replace", { delay: 1 }, 500);
			assert.deepEqual(readSettings(), original);
			// The online CLI must use the same recovery service, without startup side effects.
			await env.cli("config", "replace", "--json", JSON.stringify(valid));
			assert.equal(await env.trpc("settings.recovery"), null);
			assert.equal((await env.trpc("settings.get")).apiKey, apiKey);
			await env.stop();
		}
		report(
			"Invalid schema and malformed JSON stay unchanged until explicit online CLI replacement; both resume without key rotation",
		);
		// A failed v6 import has a different repair contract: do not lose indexers
		// by silently replacing config.js with a fresh v7 settings record.
		replaceRaw(null, apiKey);
		const configPath = join(env.configDir, "config.js");
		const file = "export default { delay: 1 };";
		await writeFile(configPath, file);
		await env.start();
		assert.equal((await env.trpc("settings.recovery")).source, "file");
		await rejected("settings.save", { delay: 123 }, 500);
		assert.equal(readSettings().settings_json, null);
		assert.equal(await readFile(configPath, "utf8"), file);
		await env.stop();
		await writeFile(
			configPath,
			"export default { delay: 123, useClientTorrents: false };",
		);
		await env.start();
		assert.equal(await env.trpc("settings.recovery"), null);
		assert.equal((await env.trpc("settings.get")).config.delay, 123);
		report(
			"Invalid legacy files leave HTTP available with repair instructions and remain intact for a full import on restart",
		);
	} finally {
		await env.close();
	}
}
