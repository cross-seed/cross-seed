import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setRuntimeConfig } from "../src/runtimeConfig.js";
import Deluge from "../src/clients/Deluge.js";
import { initializeLogger } from "../src/logger.js";
import { Result } from "../src/Result.js";

type DelugeWithPrivateCall = {
	call<T>(
		method: string,
		params: unknown[],
		retries?: number,
	): Promise<Result<T, unknown>>;
};

function callableDeluge(client: Deluge): DelugeWithPrivateCall {
	return client as unknown as DelugeWithPrivateCall;
}

function newDeluge(): Deluge {
	return new Deluge(
		"http://:password@localhost:8112",
		"test-client",
		0,
		false,
	);
}

function delugeResult(result: unknown): Response {
	return new Response(JSON.stringify({ result, error: null, id: 1 }), {
		status: 200,
	});
}

function brokenBodyResponse(status = 200): Response {
	// simulates a response whose headers arrive successfully but whose body
	// stream errors out mid-read, same failure mode as the qBittorrent
	// client's crash: the fetch() promise already resolved, so this only
	// surfaces once something tries to read the body.
	const body = new ReadableStream({
		start(controller) {
			controller.error(new TypeError("terminated"));
		},
	});
	return new Response(body, { status });
}

describe("Deluge call retries", () => {
	beforeAll(() => {
		initializeLogger({ verbose: false });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries when the response body fails to read after a successful fetch", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockResolvedValueOnce(brokenBodyResponse());
		fetchMock.mockResolvedValueOnce(delugeResult(true));
		vi.stubGlobal("fetch", fetchMock);

		const client = newDeluge();
		const result = await callableDeluge(client).call<boolean>(
			"web.connected",
			[],
			0,
		);

		if (!result.isOk()) throw new Error("expected an Ok result");
		expect(result.unwrap()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries when the initial connection fails outright", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		fetchMock.mockResolvedValueOnce(delugeResult(true));
		vi.stubGlobal("fetch", fetchMock);

		const client = newDeluge();
		const result = await callableDeluge(client).call<boolean>(
			"web.connected",
			[],
			0,
		);

		if (!result.isOk()) throw new Error("expected an Ok result");
		expect(result.unwrap()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("gives up after exhausting retries on a connection that never succeeds", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		vi.stubGlobal("fetch", fetchMock);

		const client = newDeluge();

		await expect(
			callableDeluge(client).call<boolean>("web.connected", [], 0),
		).rejects.toThrow("Failed to connect to Deluge");
	}, 15_000);
});

describe("Deluge full status and persistent authentication", () => {
	afterEach(() => vi.unstubAllGlobals());
	function server() {
		let logins = 0;
		const calls: {
			method: string;
			params: unknown[];
			cookie: string | null;
		}[] = [];
		const fetchMock = vi.fn(
			async (_url: unknown, options?: RequestInit) => {
				const request = JSON.parse(String(options?.body)) as {
					method: string;
					params: unknown[];
				};
				calls.push({
					...request,
					cookie: new Headers(options?.headers).get("Cookie"),
				});
				if (request.method === "auth.login") {
					logins++;
					return new Response(
						JSON.stringify({ result: true, error: null }),
						{
							headers: {
								"Set-Cookie": `_session_id=session-${logins}; Path=/`,
							},
						},
					);
				}
				if (request.method === "web.connected")
					return delugeResult(true);
				if (request.method === "core.get_enabled_plugins")
					return delugeResult([]);
				if (request.method === "core.get_torrents_status")
					return delugeResult({
						abc: { hash: "abc", label: "movies" },
					});
				throw new Error(`Unexpected method ${request.method}`);
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		return { calls, fetchMock, logins: () => logins };
	}
	it("shares one login across concurrent callers and keeps the session for subsequent operations", async () => {
		const rpc = server();
		const client = newDeluge();
		const results = await Promise.all(
			Array.from({ length: 10 }, () => client.getAllTorrents()),
		);
		expect(results.every((result) => result[0].infoHash === "abc")).toBe(
			true,
		);
		await client.getAllTorrents();
		expect(rpc.logins()).toBe(1);
		expect(rpc.calls.some((c) => c.method === "auth.delete_session")).toBe(
			false,
		);
		expect(
			rpc.calls
				.filter((c) => c.method === "core.get_torrents_status")
				.every((c) => c.params[2] === false),
		).toBe(true);
	});
	it("does not let a late NO_AUTH response invalidate the refreshed session", async () => {
		const rpc = server();
		const client = newDeluge();
		await client.authenticate();
		const normal = rpc.fetchMock.getMockImplementation()!;
		let oldRequests = 0;
		rpc.fetchMock.mockImplementation(async (url, options) => {
			const req = JSON.parse(String(options?.body)) as { method: string };
			if (
				req.method === "core.get_torrents_status" &&
				new Headers(options?.headers).get("Cookie") ===
					"_session_id=session-1"
			) {
				oldRequests++;
				if (oldRequests === 2)
					await new Promise((resolve) => setTimeout(resolve, 25));
				return new Response(
					JSON.stringify({
						result: null,
						error: { code: 1, message: "Not authenticated" },
					}),
				);
			}
			return normal(url, options);
		});
		await Promise.all([client.getAllTorrents(), client.getAllTorrents()]);
		expect(oldRequests).toBe(2);
		expect(rpc.logins()).toBe(2);
		expect(
			rpc.calls
				.filter((c) => c.method === "core.get_torrents_status")
				.every((c) => c.cookie === "_session_id=session-2"),
		).toBe(true);
	});
	it("uses an uncached single-torrent lookup and treats missing fields as failure without reconnecting", async () => {
		const rpc = server();
		const client = newDeluge();
		await client.authenticate();
		const normal = rpc.fetchMock.getMockImplementation()!;
		rpc.fetchMock.mockImplementation(async (url, options) => {
			const req = JSON.parse(String(options?.body)) as {
				method: string;
				params: unknown[];
			};
			if (req.method === "core.get_torrent_status") {
				expect(req.params[0]).toBe("abc");
				expect(req.params[2]).toBe(false);
				return delugeResult({ name: "incomplete" });
			}
			return normal(url, options);
		});
		const result = await client.getDownloadDir(
			{ infoHash: "ABC" } as Parameters<Deluge["getDownloadDir"]>[0],
			{ onlyCompleted: false },
		);
		expect(result.isErr()).toBe(true);
		expect(
			rpc.calls
				.filter((c) => c.method.startsWith("web."))
				.map((c) => c.method),
		).toEqual(["web.connected", "web.connected"]);
	});
	it("bounds reauthentication to one retry when the server keeps rejecting the session", async () => {
		const rpc = server();
		const client = newDeluge();
		await client.authenticate();
		const normal = rpc.fetchMock.getMockImplementation()!;
		let attempts = 0;
		rpc.fetchMock.mockImplementation(async (url, options) => {
			const req = JSON.parse(String(options?.body)) as { method: string };
			if (req.method === "core.get_torrents_status") {
				attempts++;
				return new Response(
					JSON.stringify({
						result: null,
						error: { code: 1, message: "expired" },
					}),
				);
			}
			return normal(url, options);
		});
		await client.getAllTorrents();
		expect(attempts).toBe(2);
		expect(rpc.logins()).toBe(2);
	});
	it("shares daemon reconnects and retries late failures on the repaired connection", async () => {
		const rpc = server();
		const client = newDeluge();
		await client.authenticate();
		const normal = rpc.fetchMock.getMockImplementation()!;
		let connected = true;
		let connects = 0;
		let failedRequests = 0;
		let releaseLate!: () => void;
		const late = new Promise<void>((resolve) => {
			releaseLate = resolve;
		});
		rpc.fetchMock.mockImplementation(async (url, options) => {
			const { method } = JSON.parse(String(options?.body)) as {
				method: string;
			};
			if (method === "web.connected") return delugeResult(connected);
			if (method === "web.get_hosts")
				return delugeResult([
					["daemon", "localhost", 58846, "Offline"],
				]);
			if (method === "web.connect") {
				connects++;
				connected = true;
				return delugeResult([]);
			}
			if (method === "core.get_torrents_status" && failedRequests < 2) {
				connected = false;
				failedRequests++;
				if (failedRequests === 2) await late;
				return new Response(
					JSON.stringify({
						error: { code: 2, message: "Daemon disconnected" },
					}),
				);
			}
			return normal(url, options);
		});
		const first = client.getAllTorrents();
		const second = client.getAllTorrents();
		expect((await first)[0].infoHash).toBe("abc");
		releaseLate();
		expect((await second)[0].infoHash).toBe("abc");
		expect(failedRequests).toBe(2);
		expect(connects).toBe(1);
		expect(rpc.logins()).toBe(1);
	});
	it("allows a later operation to recover after rejected login", async () => {
		const rpc = server();
		const client = newDeluge();
		rpc.fetchMock.mockResolvedValueOnce(delugeResult(false));
		await expect(client.authenticate()).rejects.toThrow(
			"failed to authenticate",
		);
		expect((await client.getAllTorrents())[0].infoHash).toBe("abc");
	});
	it("fails an incomplete inventory instead of reconciling missing entries", async () => {
		server();
		const client = newDeluge();
		await expect(client.getClientSearchees()).rejects.toThrow();
	});
	it.each([
		[false, "/links", "movies", "cross-seed"],
		[false, undefined, "movies", "movies"],
		[true, "/links", "movies", "movies.cross-seed"],
		[true, "/links", "movies.cross-seed", "movies.cross-seed"],
		[true, "/links", "cross-seed", "cross-seed"],
	] as const)(
		"preserves label parity: duplicate=%s destination=%s category=%s",
		(duplicateCategories, destinationDir, category, expected) => {
			setRuntimeConfig({
				linkCategory: "CROSS-SEED",
				duplicateCategories,
			} as Parameters<typeof setRuntimeConfig>[0]);
			const client = newDeluge() as unknown as {
				calculateLabel(
					source: { infoHash: string; category: string },
					info: undefined,
					destination?: string,
				): string;
			};
			expect(
				client.calculateLabel(
					{ infoHash: "abc", category },
					undefined,
					destinationDir,
				),
			).toBe(expected);
		},
	);
});
