import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Transmission from "../src/clients/Transmission.js";
import { initializeLogger } from "../src/logger.js";

type TransmissionWithPrivateRequest = {
	request<T>(
		method: string,
		args?: unknown,
		retries?: number,
		timeout?: number,
	): Promise<T>;
};

function callableTransmission(
	client: Transmission,
): TransmissionWithPrivateRequest {
	return client as unknown as TransmissionWithPrivateRequest;
}

function newTransmission(): Transmission {
	return new Transmission(
		"http://localhost:9091/transmission/rpc",
		"test-client",
		0,
		false,
	);
}

function transmissionResult(args: unknown): Response {
	return new Response(
		JSON.stringify({ result: "success", arguments: args }),
		{
			status: 200,
		},
	);
}

function brokenBodyResponse(status = 200): Response {
	// simulates a response whose headers arrive successfully but whose body
	// stream errors out mid-read after fetch() already resolved.
	const body = new ReadableStream({
		start(controller) {
			controller.error(new TypeError("terminated"));
		},
	});
	return new Response(body, { status });
}

describe("Transmission request retries", () => {
	beforeAll(() => {
		initializeLogger({ verbose: false });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries when the response body fails to read after a successful fetch", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockResolvedValueOnce(brokenBodyResponse());
		fetchMock.mockResolvedValueOnce(transmissionResult({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const result =
			await callableTransmission(newTransmission()).request(
				"session-get",
			);

		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries when the initial connection fails outright", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		fetchMock.mockResolvedValueOnce(transmissionResult({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const result =
			await callableTransmission(newTransmission()).request(
				"session-get",
			);

		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry a logical rejection from Transmission itself", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					result: "invalid argument",
					arguments: {},
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			callableTransmission(newTransmission()).request("session-get"),
		).rejects.toThrow(
			'Transmission responded with error: "invalid argument"',
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("gives up after exhausting retries on a body that never reads", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(() => Promise.resolve(brokenBodyResponse()));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			callableTransmission(newTransmission()).request("session-get"),
		).rejects.toThrow();
	}, 15_000);
});
