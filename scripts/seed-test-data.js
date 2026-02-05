#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import bencode from "bencode";

const ROOT = process.cwd();
const BASE_DIR = await mkdtemp(join(tmpdir(), "cross-seed-test-data-"));
const DATA_DIR = join(BASE_DIR, "data");
const OUTPUT_DIR = join(BASE_DIR, "output");
const LINK_DIR = join(BASE_DIR, "links");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(LINK_DIR, { recursive: true });

const files = [
	"Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv",
	"Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv",
	"Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv",
	"Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv",
];

const createTorrent = (name) => {
	const info = {
		name: Buffer.from(name),
		"piece length": 262144,
		pieces: Buffer.alloc(20),
		length: 1024 * 128,
	};
	const raw = {
		info,
		announce: Buffer.from("http://mock-torznab.local/announce"),
	};
	return bencode.encode(raw);
};

for (const file of files) {
	await writeFile(join(DATA_DIR, file), Buffer.alloc(1024 * 128));
	const torrentName = file.replace(/\.mkv$/, "");
	const torrent = createTorrent(torrentName);
	const torrentPath = join(
		OUTPUT_DIR,
		`[episode][mock]${torrentName}[seed].torrent`,
	);
	await writeFile(torrentPath, torrent);
}

console.log(`Seeded test data at: ${resolve(BASE_DIR)}`);
console.log(`dataDir: ${resolve(DATA_DIR)}`);
console.log(`outputDir: ${resolve(OUTPUT_DIR)}`);
console.log(`linkDir: ${resolve(LINK_DIR)}`);
