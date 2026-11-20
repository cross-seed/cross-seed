import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildHybridTorrent } from "./support/hybridTorrent.js";

// appDir() reads CONFIG_DIR when called, but importing decide.js also opens
// the database, so point it at a temporary directory first
const configDir = await mkdtemp(join(tmpdir(), "cross-seed-cache-tests-"));
process.env.CONFIG_DIR = configDir;
const cacheDir = join(configDir, "torrent_cache");
await mkdir(cacheDir, { recursive: true });
const { updateTorrentCache } = await import("../src/decide.js");

describe("updateTorrentCache", () => {
	it("rewrites tracker urls without touching the rest of a hybrid torrent", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const before = buildHybridTorrent({
			announce: "https://old.example/announce",
		});
		const after = buildHybridTorrent({
			announce: "https://new.example/announce",
		});
		const path = join(cacheDir, "hybrid.torrent");
		await writeFile(path, new Uint8Array(before.torrent));

		await updateTorrentCache("old.example", "new.example");

		const written = await readFile(path);
		expect(written.equals(after.torrent)).toBe(true);
	});

	it("rewrites the announce-list of a hybrid torrent too", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const announceList = (host: string) => [
			[`https://${host}/announce`],
			["https://other.example/announce", `udp://${host}:6969`],
		];
		const before = buildHybridTorrent({
			announce: "https://other.example/announce",
			announceList: announceList("old.example"),
		});
		const after = buildHybridTorrent({
			announce: "https://other.example/announce",
			announceList: announceList("new.example"),
		});
		const path = join(cacheDir, "hybrid-announce-list.torrent");
		await writeFile(path, new Uint8Array(before.torrent));

		await updateTorrentCache("old.example", "new.example");

		expect((await readFile(path)).equals(after.torrent)).toBe(true);
	});

	it("leaves torrents without a matching tracker untouched", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { torrent } = buildHybridTorrent({
			announce: "https://other.example/announce",
		});
		const path = join(cacheDir, "unrelated.torrent");
		await writeFile(path, new Uint8Array(torrent));

		await updateTorrentCache("old.example", "new.example");

		expect((await readFile(path)).equals(torrent)).toBe(true);
	});
});
