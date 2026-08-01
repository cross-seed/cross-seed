import { beforeAll, describe, expect, it } from "vitest";
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
	beforeAll(() => {
		initializeLogger({ verbose: false });
	});

	it("retries after a transient RPC failure and succeeds", async () => {
		let calls = 0;
		const client = newRTorrent();
		stubMethodCall(client, (_method, _args, callback) => {
			calls++;
			if (calls === 1) {
				callback(new Error("ECONNRESET"), undefined);
				return;
			}
			callback(null, ["abc123"]);
		});

		const result = await client.isTorrentInClient("abc123");

		if (!result.isOk()) throw new Error("expected an Ok result");
		expect(result.unwrap()).toBe(true);
		expect(calls).toBe(2);
	});

	it("gives up after exhausting retries on a connection that never succeeds", async () => {
		let calls = 0;
		const client = newRTorrent();
		stubMethodCall(client, (_method, _args, callback) => {
			calls++;
			callback(new Error("ECONNRESET"), undefined);
		});

		const result = await client.isTorrentInClient("abc123");

		expect(result.isErr()).toBe(true);
		expect(calls).toBe(4); // 1 initial attempt + 3 retries
	}, 15_000);
});
