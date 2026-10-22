import { afterEach, describe, expect, it, vi } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";

vi.mock("../src/logger.js", () => ({
	Label: {},
	logger: { verbose: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function client(): QBittorrent {
	return new QBittorrent(
		"http://user:pass@localhost:8080",
		"localhost:8080",
		1,
		false,
	);
}

describe("qBittorrent isTorrentInClient", () => {
	it("answers false instead of failing when the client has no torrents", async () => {
		const qb = client();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
		const result = await qb.isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(false);
	});

	it("still returns Err when the client request really fails", async () => {
		const qb = client();
		vi.spyOn(qb, "getAllTorrentInfo").mockRejectedValue(new Error("boom"));
		const result = await qb.isTorrentInClient("abc");
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.unwrapErr().message).toBe("boom");
	});

	it("still finds a torrent by hash", async () => {
		const qb = client();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response('[{"hash":"ABC"}]')),
		);
		const result = await qb.isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(true);
	});
});

describe("qBittorrent torrent-list request failures", () => {
	it.each(["", "not json", "null", "{}"])(
		"rejects invalid response %j",
		async (body) => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(new Response(body)),
			);
			expect((await client().isTorrentInClient("abc")).isErr()).toBe(
				true,
			);
		},
	);

	it("returns Err after exhausting network retries", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockRejectedValue(new Error("connection refused"));
		vi.stubGlobal("fetch", fetchMock);
		const pending = client().isTorrentInClient("abc");
		await vi.runAllTimersAsync();
		expect((await pending).isErr()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});
