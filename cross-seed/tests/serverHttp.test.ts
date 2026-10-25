import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.sequential("HTTP server contracts", () => {
	let directory: string;
	let db: typeof import("../src/db.js").db;
	let logger: typeof import("../src/logger.js").logger;
	let createHttpApp: typeof import("../src/server.js").createHttpApp;
	const apiKey = "server-http-contract-key";
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "cross-seed-http-"));
		process.env.CONFIG_DIR = directory;
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		({ db } = await import("../src/db.js"));
		await db.migrate.latest();
		const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
		setRuntimeConfig({ ...config.getDefaultRuntimeConfig(), apiKey });
		const { setDbConfig } = await import("../src/dbConfig.js");
		await setDbConfig({ ...config.getDefaultRuntimeConfig(), apiKey });
		({ createHttpApp } = await import("../src/server.js"));
	});
	afterAll(async () => {
		await db?.destroy();
		logger?.close();
		delete process.env.CONFIG_DIR;
		await rm(directory, { recursive: true, force: true });
	});
	function start(basePath = "") {
		return createHttpApp(basePath);
	}
	it.each(["", "/cross-seed"])(
		"preserves ping and API-key authentication under %s",
		async (basePath) => {
			const server = start(basePath);
			const ping = await server.request(`${basePath}/api/ping`);
			expect(ping.status).toBe(200);
			expect(await ping.text()).toBe("OK");
			const rejected = await server.request(`${basePath}/api/status`);
			expect(rejected.status).toBe(401);
			expect(await rejected.text()).toBe(
				"Specify the API key in an X-Api-Key header or an apikey query param.",
			);
			for (const options of [
				{
					url: `${basePath}/api/status`,
					headers: { "x-api-key": apiKey },
				},
				{ url: `${basePath}/api/status?apikey=${apiKey}` },
			]) {
				const response = await server.request(options.url, {
					headers: options.headers,
				});
				expect(response.status).toBe(200);
				expect(await response.text()).toBe("OK");
			}
		},
	);
	it("retains unauthorized tRPC errors and indexer settings procedures", async () => {
		const server = start();
		for (const procedure of ["settings.get", "indexers.getAll"]) {
			const response = await server.request(`/api/trpc/${procedure}`);
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				error: { data: { code: "UNAUTHORIZED" } },
			});
		}
	});
	it.each(["", "/cross-seed"])(
		"removes the Prowlarr indexer REST API under %s",
		async (basePath) => {
			const server = start(basePath);
			for (const endpoint of ["", "/status", "/1", "/test"]) {
				for (const method of [
					"GET",
					"POST",
					"PUT",
					"DELETE",
				] as const) {
					const response = await server.request(
						`${basePath}/api/indexer/v1${endpoint}`,
						{
							method,
							headers: {
								"x-api-key": apiKey,
								accept: "application/json",
							},
						},
					);
					expect(response.status).toBe(404);
				}
			}
		},
	);
});
