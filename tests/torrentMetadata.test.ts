import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TorrentClient as TorrentClientType } from "../src/clients/TorrentClient.js";
import { buildHybridTorrent } from "./support/hybridTorrent.js";

// importing torrent.js opens the database, so point CONFIG_DIR at a temporary
// directory first
process.env.CONFIG_DIR = await mkdtemp(
	join(tmpdir(), "cross-seed-metadata-tests-"),
);

const TorrentClient = await import("../src/clients/TorrentClient.js");
const { Label } = await import("../src/logger.js");
const { parseTorrentWithMetadata } = await import("../src/torrent.js");

// only qBittorrent keeps what cross-seed reads in a .fastresume file
vi.spyOn(TorrentClient, "getClients").mockReturnValue([
	{ clientType: Label.QBITTORRENT } as TorrentClientType,
]);

// Bencoded by hand, the way qBittorrent writes the fields cross-seed reads,
// beside two kinds of field that real files carry and the codec must accept:
// a binary value that is not valid UTF-8, and an integer above 2^32.
const text = (value: string) =>
	Buffer.from(`${Buffer.byteLength(value)}:${value}`);
const fastresume = (tracker: string) =>
	Buffer.concat([
		Buffer.from("d"),
		text("info-hash"),
		Buffer.from("20:"),
		Buffer.from(Array.from({ length: 20 }, (_, i) => 0x80 + i)),
		text("qBt-category"),
		text("movies"),
		text("qBt-tags"),
		text("cross-seed,private"),
		text("total_downloaded"),
		Buffer.from("i5000000000e"),
		text("trackers"),
		Buffer.from("ll"),
		text(tracker),
		Buffer.from("ee"),
		Buffer.from("e"),
	]);

describe("parseTorrentWithMetadata with qBittorrent", () => {
	it("reads the category, tags and trackers from the .fastresume file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cross-seed-fastresume-"));
		const torrentPath = join(dir, "hybrid.torrent");
		await writeFile(
			torrentPath,
			new Uint8Array(buildHybridTorrent().torrent),
		);
		await writeFile(
			join(dir, "hybrid.fastresume"),
			new Uint8Array(fastresume("https://resume.example/announce")),
		);

		const meta = await parseTorrentWithMetadata(torrentPath, []);

		expect(meta.category).toBe("movies");
		expect(meta.tags).toEqual(["cross-seed", "private"]);
		// the tracker in the .torrent is tracker.example
		expect(meta.trackers).toEqual(["resume.example"]);
	});
});
