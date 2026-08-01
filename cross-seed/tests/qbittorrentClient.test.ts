import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";
import { initializeLogger } from "../src/logger.js";

function brokenBodyResponse(status = 200): Response {
	// simulates a response whose headers arrive successfully but whose body
	// stream errors out mid-read (e.g. qBittorrent's embedded HTTP server
	// closing the socket while the body is still being sent - observed in
	// production as "TypeError: terminated" / "SocketError: other side
	// closed").
	const body = new ReadableStream({
		start(controller) {
			controller.error(new TypeError("terminated"));
		},
	});
	return new Response(body, { status });
}

describe("QBittorrent request retries", () => {
	beforeAll(() => {
		initializeLogger({ verbose: false });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries when the response body fails to read after a successful fetch", async () => {
		const fetchMock = vi.fn();
		// POST /auth/login
		fetchMock.mockResolvedValueOnce(
			new Response("Ok.", {
				status: 200,
				headers: { "set-cookie": "SID=test-session" },
			}),
		);
		// first POST /app/version: headers arrive, body read fails
		fetchMock.mockResolvedValueOnce(brokenBodyResponse());
		// retry succeeds
		fetchMock.mockResolvedValueOnce(new Response("4.6.0", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new QBittorrent(
			"http://user:pass@localhost:8282",
			"test-client",
			0,
			false,
		);

		await expect(client.login()).resolves.toBeUndefined();

		expect(client.version).toBe("4.6.0");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("gives up and returns undefined after the body read keeps failing past the retry budget", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockResolvedValueOnce(
			new Response("Ok.", {
				status: 200,
				headers: { "set-cookie": "SID=test-session" },
			}),
		);
		// every /app/version attempt fails to read its body (a fresh broken
		// stream each time, since a Response's body can only be read once)
		fetchMock.mockImplementation(() =>
			Promise.resolve(brokenBodyResponse()),
		);
		vi.stubGlobal("fetch", fetchMock);

		const client = new QBittorrent(
			"http://user:pass@localhost:8282",
			"test-client",
			0,
			false,
		);

		await expect(client.login()).rejects.toThrow(
			"Unable to retrieve version",
		);
	}, 15_000);
});
