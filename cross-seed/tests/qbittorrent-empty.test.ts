import { describe, expect, it } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";

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
		qb.getAllTorrentInfo = async () => [];
		const result = await qb.isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(false);
	});

	it("still returns Err when the client request really fails", async () => {
		const qb = client();
		qb.getAllTorrentInfo = async () => {
			throw new Error("boom");
		};
		const result = await qb.isTorrentInClient("abc");
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.unwrapErr().message).toBe("boom");
	});

	it("still finds a torrent by hash", async () => {
		const qb = client();
		qb.getAllTorrentInfo = async () =>
			[{ hash: "ABC" }] as Awaited<
				ReturnType<QBittorrent["getAllTorrentInfo"]>
			>;
		const result = await qb.isTorrentInClient("abc");
		if (!result.isOk()) throw result.unwrapErr();
		expect(result.unwrap()).toBe(true);
	});
});
