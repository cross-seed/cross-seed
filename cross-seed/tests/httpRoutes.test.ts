import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { search, index, match, jobs, runJobs, subscribe, unsubscribe } =
	vi.hoisted(() => ({
		search: vi.fn().mockResolvedValue(0),
		index: vi.fn().mockResolvedValue(undefined),
		match: vi.fn(),
		jobs: vi.fn<
			() => {
				name: string;
				isActive: boolean;
				runAheadOfSchedule: boolean;
			}[]
		>(() => []),
		runJobs: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	}));
vi.mock("../src/pipeline.js", async (original) => ({
	...(await original<typeof import("../src/pipeline.js")>()),
	searchForLocalTorrentByCriteria: search,
	checkNewCandidateMatch: match,
}));
vi.mock("../src/torrent.js", async (original) => ({
	...(await original<typeof import("../src/torrent.js")>()),
	indexTorrentsAndDataDirs: index,
}));
vi.mock("../src/jobs.js", async (original) => ({
	...(await original<typeof import("../src/jobs.js")>()),
	getJobs: jobs,
	checkJobs: runJobs,
}));
vi.mock("../src/utils/logWatcher.js", () => ({
	getLogWatcher: () => ({
		getRecentLogs: () => Promise.resolve([]),
		subscribe: () => {
			subscribe();
			return unsubscribe;
		},
	}),
}));

describe.sequential("Hono HTTP behavior", () => {
	let directory: string;
	let db: typeof import("../src/db.js").db;
	let logging: typeof import("../src/logger.js");
	let serverModule: typeof import("../src/server.js");
	let constants: typeof import("../src/constants.js");
	let cookie: string;
	const key = "http-routes-test-api-key";
	const hash = "A".repeat(40);
	const candidate = {
		name: "Fictional.Show.S01E01.1080p.WEB-GROUP",
		guid: "https://example.invalid/torrent/1",
		link: "https://example.invalid/torrent/1",
		tracker: "fictional",
	};
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "hono-http-"));
		process.env.CONFIG_DIR = directory;
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logging.logger.silent = true;
		({ db } = await import("../src/db.js"));
		await db.migrate.latest();
		const runtime = { ...config.getDefaultRuntimeConfig(), apiKey: key };
		(await import("../src/runtimeConfig.js")).setRuntimeConfig(runtime);
		await (await import("../src/dbConfig.js")).setDbConfig(runtime);
		const auth = await import("../src/userAuth.js");
		const user = await auth.createInitialUserIfNeeded(
			"http-user",
			"http-test-password",
		);
		const session = await auth.createSession(user!.id);
		cookie = `cross-seed-session=${session.id}`;
		constants = await import("../src/constants.js");
		serverModule = await import("../src/server.js");
	});
	beforeEach(() => {
		vi.clearAllMocks();
		search.mockResolvedValue(0);
		jobs.mockReturnValue([]);
	});
	afterAll(async () => {
		await db.destroy();
		logging.logger.close();
		delete process.env.CONFIG_DIR;
		await rm(directory, { recursive: true, force: true });
	});
	function post(path: string, data: unknown, basePath = "") {
		return serverModule
			.createHttpApp(basePath)
			.request(`${basePath}/api/${path}`, {
				method: "POST",
				headers: {
					"x-api-key": key,
					"content-type": "application/json",
				},
				body: JSON.stringify(data),
			});
	}
	it.each(["", "/cross-seed"])(
		"preserves CORS and restricts it to legacy integration routes at %s",
		async (basePath) => {
			const app = serverModule.createHttpApp(basePath);
			const preflight = await app.request(`${basePath}/api/webhook`, {
				method: "OPTIONS",
				headers: {
					origin: "https://example.invalid",
					"access-control-request-method": "POST",
					"access-control-request-headers": "x-api-key,content-type",
				},
			});
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(
				"*",
			);
			expect(preflight.headers.get("access-control-allow-headers")).toBe(
				"x-api-key,content-type",
			);
			const tooLarge = await app.request(`${basePath}/api/announce`, {
				method: "POST",
				headers: {
					origin: "https://example.invalid",
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: "x".repeat(1024 * 1024) }),
			});
			expect(tooLarge.status).toBe(413);
			expect(tooLarge.headers.get("access-control-allow-origin")).toBe(
				"*",
			);

			const rejected = await app.request(`${basePath}/api/announce`, {
				method: "POST",
				headers: { origin: "https://example.invalid" },
			});
			expect(rejected.status).toBe(401);
			expect(rejected.headers.get("access-control-allow-origin")).toBe(
				"*",
			);
			expect(
				(
					await app.request(`${basePath}/api/status`, {
						headers: { origin: "https://example.invalid" },
					})
				).headers.get("access-control-allow-origin"),
			).toBeNull();
		},
	);
	it.each(["application/json", "application/x-www-form-urlencoded"])(
		"preserves webhook parsing for %s and acknowledges while searching",
		async (type) => {
			let finish!: () => void;
			search.mockImplementationOnce(
				() =>
					new Promise<number>((resolve) => {
						finish = () => resolve(0);
					}),
			);
			const app = serverModule.createHttpApp();
			const data = {
				infoHash: hash,
				ignoreCrossSeeds: "false",
				includeSingleEpisodes: "true",
			};
			try {
				const response = await app.request("/api/webhook", {
					method: "POST",
					headers: {
						"x-api-key": key,
						"content-type": `${type}; charset=utf-8`,
					},
					body:
						type === "application/json"
							? JSON.stringify(data)
							: new URLSearchParams(data).toString(),
				});
				expect(response.status).toBe(204);
				expect(await response.text()).toBe("");
				expect(search).toHaveBeenCalledWith(
					expect.objectContaining({ infoHash: hash.toLowerCase() }),
					expect.objectContaining({
						ignoreCrossSeeds: false,
					}),
				);
				expect(search.mock.calls[0]?.[1]).toMatchObject({
					configOverride: { includeSingleEpisodes: true },
				});
			} finally {
				finish?.();
			}
		},
	);
	it("retains validation, parsing, unsupported media, and size errors", async () => {
		expect((await post("announce", {})).status).toBe(400);
		expect((await post("job", { name: "not-a-job" })).status).toBe(400);
		const app = serverModule.createHttpApp();
		const unsupported = await app.request("/api/announce", {
			method: "POST",
			headers: {
				"x-api-key": key,
				"content-type": "application/octet-stream",
			},
			body: "bad",
		});
		expect(unsupported.status).toBe(415);
		expect(await unsupported.json()).toMatchObject({
			code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
		});
		expect((await post("announce", null)).status).toBe(500);
		expect(
			(await post("announce", { name: "x".repeat(1024 * 1024) })).status,
		).toBe(413);
		expect(match).not.toHaveBeenCalled();
	});
	it("retains form fallback for JSON-labelled integration requests", async () => {
		const response = await serverModule
			.createHttpApp()
			.request("/api/webhook", {
				method: "POST",
				headers: {
					"x-api-key": key,
					"content-type": "application/json",
				},
				body: `infoHash=${hash}`,
			});
		expect(response.status).toBe(204);
		expect(search).toHaveBeenCalledWith(
			expect.objectContaining({ infoHash: hash.toLowerCase() }),
			expect.anything(),
		);
	});
	it.each([
		"no match",
		"injected",
		"saved",
		"incomplete",
		"already present",
		"failure",
	])("retains announce response for %s", async (outcome) => {
		const { Decision, InjectionResult, SaveResult } = constants;
		const results = {
			"no match": { decision: null, actionResult: null, status: 204 },
			injected: {
				decision: Decision.MATCH,
				actionResult: InjectionResult.SUCCESS,
				status: 200,
			},
			saved: {
				decision: Decision.MATCH,
				actionResult: SaveResult.SAVED,
				status: 200,
			},
			incomplete: {
				decision: Decision.MATCH,
				actionResult: InjectionResult.TORRENT_NOT_COMPLETE,
				status: 202,
			},
			"already present": {
				decision: Decision.INFO_HASH_ALREADY_EXISTS,
				actionResult: null,
				status: 200,
			},
			failure: {
				decision: Decision.MATCH,
				actionResult: InjectionResult.FAILURE,
				status: 200,
			},
		};
		const expected = results[outcome as keyof typeof results];
		match.mockResolvedValueOnce(expected);
		const response = await post("announce", candidate);
		expect(response.status).toBe(expected.status);
		expect(await response.text()).toBe("");
	});
	it("reports announce failures with the legacy 500 message", async () => {
		match.mockRejectedValueOnce(
			new Error("indexer temporarily unavailable"),
		);
		const response = await post("announce", candidate);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("indexer temporarily unavailable");
	});
	it("preserves disabled/running/scheduled job responses", async () => {
		expect((await post("job", { name: "search" })).status).toBe(404);
		const job = {
			name: "search",
			isActive: true,
			runAheadOfSchedule: false,
			shouldRun: vi.fn().mockReturnValue(false),
		};
		jobs.mockReturnValue([job]);
		expect((await post("job", { name: "search" })).status).toBe(404);
		job.shouldRun.mockReturnValue(true);
		expect((await post("job", { name: "search" })).status).toBe(409);
		job.isActive = false;
		expect((await post("job", { name: "search" })).status).toBe(200);
		expect(job.runAheadOfSchedule).toBe(true);
		expect(runJobs).toHaveBeenCalledWith({
			isFirstRun: false,
			useQueue: true,
		});
	});
	it("keeps session login, authenticated access, and logout cookie semantics", async () => {
		const app = serverModule.createHttpApp("/cross-seed");
		const login = await app.request("/cross-seed/api/trpc/auth.logIn", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				username: "http-user",
				password: "http-test-password",
			}),
		});
		expect(login.status).toBe(200);
		const session = login.headers.get("set-cookie")!;
		expect(session).toContain("HttpOnly");
		expect(session).toContain("SameSite=Lax");
		expect(session).toContain("Max-Age=2592000");
		expect(session).toContain("Path=/");
		const headers = { cookie: session.split(";")[0] };
		expect(
			(
				await app.request("/cross-seed/api/trpc/indexers.getAll", {
					headers,
				})
			).status,
		).toBe(200);
		const logout = await app.request("/cross-seed/api/trpc/auth.logOut", {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: "null",
		});
		expect(logout.status).toBe(200);
		expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(
			(
				await app.request("/cross-seed/api/trpc/settings.get", {
					headers: { cookie: "cross-seed-session=invalid" },
				})
			).status,
		).toBe(401);
	});
	it.each(["", "/cross-seed"])(
		"handles chunked requests through the real Node adapter at %s",
		async (basePath) => {
			const nativeRequest = globalThis.Request;
			const server = serverModule.createServer(basePath);
			await server.listen({ port: 0, host: "127.0.0.1" });
			const address = server.server.address();
			if (!address || typeof address === "string")
				throw new Error("No listener");
			const postStream = (path: string, body: string) => {
				const init = {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-api-key": key,
					},
					body: new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(body));
							controller.close();
						},
					}),
					duplex: "half",
				};
				return fetch(
					`http://127.0.0.1:${address.port}${basePath}${path}`,
					init,
				);
			};
			try {
				const login = await postStream(
					"/api/trpc/auth.logIn",
					JSON.stringify({
						username: "http-user",
						password: "http-test-password",
					}),
				);
				const result: unknown = await login.json();
				expect(login.status, JSON.stringify(result)).toBe(200);
				expect(result).toHaveProperty("result");
				expect(login.headers.get("set-cookie")).toContain("HttpOnly");
				const webhook = await postStream(
					"/api/webhook",
					JSON.stringify({ infoHash: hash }),
				);
				expect(await webhook.text()).toBe("");
				expect(webhook.status).toBe(204);
				expect(search).toHaveBeenCalled();
				const oversized = await postStream(
					"/api/announce",
					JSON.stringify({ name: "x".repeat(1024 * 1024) }),
				);
				expect(oversized.status).toBe(413);
				expect(await oversized.json()).toHaveProperty(
					"code",
					"FST_ERR_CTP_BODY_TOO_LARGE",
				);
				expect(globalThis.Request).toBe(nativeRequest);
				const traceStatus = await new Promise<number>(
					(resolve, reject) => {
						const request = httpRequest(
							`http://127.0.0.1:${address.port}${basePath}/api/ping`,
							{ method: "TRACE" },
							(response) => {
								response.resume();
								response.on("end", () =>
									resolve(response.statusCode!),
								);
							},
						);
						request.on("error", reject);
						request.end();
					},
				);
				expect(traceStatus).toBe(404);
			} finally {
				await server.close();
			}
		},
	);
	it("streams authenticated tRPC subscriptions and releases them on disconnect", async () => {
		const server = serverModule.createServer();
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address();
		if (!address || typeof address === "string")
			throw new Error("No listener");
		const abort = new AbortController();
		try {
			const response = await fetch(
				`http://127.0.0.1:${address.port}/api/trpc/logs.subscribe?input=${encodeURIComponent(JSON.stringify({ limit: 1 }))}`,
				{
					headers: { cookie, accept: "text/event-stream" },
					signal: abort.signal,
				},
			);
			expect(
				response.status,
				response.status === 200 ? "" : await response.text(),
			).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
			abort.abort();
			await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
		} finally {
			abort.abort();
			await server.close();
		}
	});
	it("drains acknowledged webhook work before finishing shutdown", async () => {
		const server = serverModule.createServer();
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address();
		if (!address || typeof address === "string")
			throw new Error("No listener");
		let finish!: () => void;
		search.mockImplementationOnce(
			() =>
				new Promise<number>((resolve) => {
					finish = () => resolve(0);
				}),
		);
		try {
			const response = await fetch(
				`http://127.0.0.1:${address.port}/api/webhook`,
				{
					method: "POST",
					headers: {
						"x-api-key": key,
						"content-type": "application/json",
					},
					body: JSON.stringify({ infoHash: hash }),
				},
			);
			expect(response.status).toBe(204);
			await response.text();
			let closed = false;
			const closing = server.close().then(() => {
				closed = true;
			});
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(closed).toBe(false);
			finish();
			await closing;
			expect(closed).toBe(true);
		} finally {
			finish?.();
			await server.close();
		}
	});
	it("closes an active SSE subscription during server shutdown", async () => {
		const server = serverModule.createServer();
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address();
		if (!address || typeof address === "string")
			throw new Error("No listener");
		const abort = new AbortController();
		try {
			const response = await fetch(
				`http://127.0.0.1:${address.port}/api/trpc/logs.subscribe?input=${encodeURIComponent(JSON.stringify({ limit: 1 }))}`,
				{
					headers: { cookie, accept: "text/event-stream" },
					signal: abort.signal,
				},
			);
			expect(response.status).toBe(200);
			await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
			await server.close();
			expect(unsubscribe).toHaveBeenCalledOnce();
		} finally {
			abort.abort();
			await server.close();
		}
	});
	it("handles the frontend's batched tRPC queries over real HTTP", async () => {
		const { createTRPCClient, httpBatchLink } =
			await import("@trpc/client");
		const server = serverModule.createServer("/cross-seed");
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address();
		if (!address || typeof address === "string")
			throw new Error("No listener");
		try {
			const client = createTRPCClient<
				import("../src/trpc/routers/index.js").AppRouter
			>({
				links: [
					httpBatchLink({
						url: `http://127.0.0.1:${address.port}/cross-seed/api/trpc`,
						headers: { cookie },
					}),
				],
			});
			const [status, indexers] = await Promise.all([
				client.auth.authStatus.query(),
				client.indexers.getAll.query(),
			]);
			expect(status.isLoggedIn).toBe(true);
			expect(indexers).toEqual([]);
		} finally {
			await server.close();
		}
	});
	it("retains optional dev-login redirects and rejects external redirect targets", async () => {
		process.env.CROSS_SEED_DEV_LOGIN = "true";
		try {
			const app = serverModule.createHttpApp("/cross-seed");
			const sessionId = cookie.split("=")[1];
			const good = await app.request(
				`/cross-seed/api/dev-login/${sessionId}?redirectTo=/settings/general`,
			);
			expect(good.status).toBe(302);
			expect(good.headers.get("location")).toBe(
				"/cross-seed/settings/general",
			);
			expect(good.headers.get("set-cookie")).toContain("HttpOnly");
			const external = await app.request(
				`/cross-seed/api/dev-login/${sessionId}?redirectTo=//example.invalid`,
			);
			expect(external.headers.get("location")).toBe("/cross-seed/");
			expect(
				(await app.request("/cross-seed/api/dev-login/invalid")).status,
			).toBe(404);
		} finally {
			delete process.env.CROSS_SEED_DEV_LOGIN;
		}
	});
});
