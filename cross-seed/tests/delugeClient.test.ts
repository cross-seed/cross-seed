import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
