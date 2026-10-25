import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

describe.sequential("HTTP server contracts", () => {
	let directory: string;
	let db: typeof import("../src/db.js").db;
	let logger: typeof import("../src/logger.js").logger;
	let createServer: typeof import("../src/server.js").createServer;
	let app: FastifyInstance | undefined;
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
		({ createServer } = await import("../src/server.js"));
	});
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});
	afterAll(async () => {
		await db?.destroy();
		logger?.close();
		delete process.env.CONFIG_DIR;
		await rm(directory, { recursive: true, force: true });
	});
	async function start(basePath = "") {
		({ app } = await createServer(basePath));
		await app.ready();
		return app;
	}
	it.each(["", "/cross-seed"])(
		"preserves ping and API-key authentication under %s",
		async (basePath) => {
			const server = await start(basePath);
			const ping = await server.inject(`${basePath}/api/ping`);
			expect(ping.statusCode).toBe(200);
			expect(ping.body).toBe("OK");
			const rejected = await server.inject(`${basePath}/api/status`);
			expect(rejected.statusCode).toBe(401);
			expect(rejected.body).toBe(
				"Specify the API key in an X-Api-Key header or an apikey query param.",
			);
			for (const options of [
				{
					url: `${basePath}/api/status`,
					headers: { "x-api-key": apiKey },
				},
				{ url: `${basePath}/api/status?apikey=${apiKey}` },
			]) {
				const response = await server.inject(options);
				expect(response.statusCode).toBe(200);
				expect(response.body).toBe("OK");
			}
		},
	);
	it("retains unauthorized tRPC errors and indexer settings procedures", async () => {
		const server = await start();
		for (const procedure of ["settings.get", "indexers.getAll"]) {
			const response = await server.inject(`/api/trpc/${procedure}`);
			expect(response.statusCode).toBe(401);
			expect(response.json()).toMatchObject({
				error: { data: { code: "UNAUTHORIZED" } },
			});
		}
	});
	it.each(["", "/cross-seed"])(
		"removes the Prowlarr indexer REST API under %s",
		async (basePath) => {
			const server = await start(basePath);
			for (const endpoint of ["", "/status", "/1", "/test"]) {
				for (const method of [
					"GET",
					"POST",
					"PUT",
					"DELETE",
				] as const) {
					const response = await server.inject({
						method,
						url: `${basePath}/api/indexer/v1${endpoint}`,
						headers: {
							"x-api-key": apiKey,
							accept: "application/json",
						},
					});
					expect(response.statusCode).toBe(404);
				}
			}
		},
	);
});
