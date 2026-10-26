import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Transmission from "../src/clients/Transmission.js";
import { Decision, InjectionResult } from "../src/constants.js";
import { initializeLogger } from "../src/logger.js";
import type { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";
import type { Searchee } from "../src/searchee.js";

function newTransmission(): Transmission {
	return new Transmission(
		"http://localhost:9091/transmission/rpc",
		"localhost:9091",
		1,
		false,
	);
}

function transmissionResult(args: unknown, result = "success"): Response {
	return new Response(JSON.stringify({ result, arguments: args }));
}

beforeAll(() => {
	initializeLogger({ verbose: false });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Transmission isTorrentInClient", () => {
	it("answers false instead of failing when the client has no torrents", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(transmissionResult({ torrents: [] })),
		);
		const result = await newTransmission().isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(false);
	});

	it("still returns Err when Transmission rejects the request", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(transmissionResult({}, "error")),
		);
		const result = await newTransmission().isTorrentInClient("abc");
		expect(result.isErr()).toBe(true);
	});

	it("still finds a torrent by hash", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					transmissionResult({ torrents: [{ hashString: "ABC" }] }),
				),
		);
		const result = await newTransmission().isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(true);
	});
});

describe("Transmission inject on an empty client", () => {
	it("adds the torrent", async () => {
		setRuntimeConfig({ ...getRuntimeConfig(), skipRecheck: true });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(transmissionResult({ torrents: [] }))
			.mockResolvedValueOnce(
				transmissionResult({
					"torrent-added": { hashString: "new", id: 1, name: "new" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const newTorrent = {
			infoHash: "new",
			files: [],
			encode: () => Buffer.from([1]),
		} as unknown as Metafile;
		const searchee = { name: "old", files: [] } as unknown as Searchee;

		const result = await newTransmission().inject(
			newTorrent,
			searchee,
			Decision.MATCH,
			{ onlyCompleted: false, destinationDir: "/tmp" },
		);

		expect(result).toBe(InjectionResult.SUCCESS);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
		const addRequest = JSON.parse(init.body as string) as {
			method: string;
			arguments: Record<string, unknown>;
		};
		expect(addRequest.method).toBe("torrent-add");
		expect(addRequest.arguments["download-dir"]).toBe("/tmp");
	});
});
