import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Client } from "xmlrpc";
import RTorrent from "../src/clients/RTorrent.js";
import { initializeLogger } from "../src/logger.js";

type MethodCallCallback = (err: unknown, data: unknown) => void;

function newRTorrent(): RTorrent {
	return new RTorrent("http://localhost:8080/RPC2", "test-client", 0, false);
}

function stubMethodCall(
	client: RTorrent,
	implementation: (
		method: string,
		args: unknown[],
		callback: MethodCallCallback,
	) => void,
) {
	client.client = { methodCall: implementation } as unknown as Client;
}

describe("RTorrent methodCallP retries", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	beforeAll(() => {
		initializeLogger({ verbose: false });
	});

	it("retries after a transient RPC failure and succeeds", async () => {
		let calls = 0;
		const client = newRTorrent();
		stubMethodCall(client, (_method, _args, callback) => {
			calls++;
			if (calls === 1) {
				callback(
					Object.assign(new Error("socket hang up"), {
						code: "ECONNRESET",
					}),
					undefined,
				);
				return;
			}
			callback(null, ["abc123"]);
		});

		const pending = client.isTorrentInClient("abc123");
		await vi.runAllTimersAsync();
		const result = await pending;

		if (!result.isOk()) throw new Error("expected an Ok result");
		expect(result.unwrap()).toBe(true);
		expect(calls).toBe(2);
	});

	it("gives up after exhausting retries on a connection that never succeeds", async () => {
		let calls = 0;
		const client = newRTorrent();
		stubMethodCall(client, (_method, _args, callback) => {
			calls++;
			callback(
				Object.assign(new Error("socket hang up"), {
					code: "ECONNRESET",
				}),
				undefined,
			);
		});

		const pending = client.isTorrentInClient("abc123");
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(calls).toBe(4); // 1 initial attempt + 3 retries
	});

	it.each([
		Object.assign(new Error("Could not find info-hash."), {
			faultCode: -501,
			faultString: "Could not find info-hash.",
		}),
		new TypeError("unexpected client bug"),
		{ faultCode: -501, faultString: "Unknown method" },
	])("does not retry permanent or unexpected failures: %s", async (error) => {
		const client = newRTorrent();
		const methodCall = vi.fn(
			(_method, _args, callback: MethodCallCallback) => {
				callback(error, undefined);
			},
		);
		stubMethodCall(client, methodCall);

		const result = await client.isTorrentInClient("abc123");

		expect(result.isErr()).toBe(true);
		expect(methodCall).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
