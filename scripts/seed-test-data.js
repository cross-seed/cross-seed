#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import bencode from "bencode";

const args = process.argv.slice(2);
const DEFAULT_ANNOUNCE_URL = "http://mock-torznab.local/announce";
const DEFAULT_PIECE_LENGTH = 16 * 1024;
const DEFAULT_TRACKER = "mock-torznab";

const getArg = (name) => {
	const hit = args.findIndex(
		(arg) => arg === `--${name}` || arg.startsWith(`--${name}=`),
	);
	if (hit === -1) return undefined;
	const raw = args[hit];
	if (raw.includes("=")) return raw.split("=").slice(1).join("=");
	return args[hit + 1];
};

const hasFlag = (name) => args.includes(`--${name}`);

function printUsage() {
	console.log(
		`Usage: npm run seed-test-data -- [--base-dir=/tmp/cross-seed-dev] [--announce-url=${DEFAULT_ANNOUNCE_URL}]`,
	);
}

function createFixtureContents(label, size) {
	const header = Buffer.from(`cross-seed fixture ${label}\n`, "utf8");
	const chunks = [];
	let written = 0;
	while (written < size) {
		const next = header.subarray(
			0,
			Math.min(header.length, size - written),
		);
		chunks.push(next);
		written += next.length;
	}
	return Buffer.concat(chunks);
}

async function writeFixtureFile(filePath, size, label) {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, createFixtureContents(label, size));
}

function sha1(buffer) {
	return createHash("sha1").update(buffer).digest();
}

async function buildTorrentBuffer({
	name,
	sourceFiles,
	announceUrl,
	pieceLength,
}) {
	const files = await Promise.all(
		sourceFiles.map(async (file) => ({
			...file,
			content: await readFile(file.sourcePath),
		})),
	);
	const payload = Buffer.concat(files.map((file) => file.content));
	const pieces = [];
	for (let offset = 0; offset < payload.length; offset += pieceLength) {
		pieces.push(sha1(payload.subarray(offset, offset + pieceLength)));
	}

	const info = {
		name: Buffer.from(name),
		"piece length": pieceLength,
		pieces: Buffer.concat(pieces),
	};

	if (files.length === 1) {
		info.length = files[0].content.length;
	} else {
		info.files = files.map((file) => ({
			length: file.content.length,
			path: file.torrentPath
				.split(/[/\\]+/)
				.filter(Boolean)
				.map((segment) => Buffer.from(segment)),
		}));
	}

	const torrent = {
		announce: Buffer.from(announceUrl),
		"announce-list": [[Buffer.from(announceUrl)]],
		"created by": Buffer.from("cross-seed seed-test-data"),
		"creation date": Math.floor(Date.now() / 1000),
		info,
	};
	const torrentBuffer = bencode.encode(torrent);
	const infoHash = createHash("sha1")
		.update(bencode.encode(info))
		.digest("hex");

	return {
		torrentBuffer,
		infoHash,
		size: payload.length,
		files: files.map((file) => ({
			path: file.torrentPath,
			length: file.content.length,
			sourcePath: file.sourcePath,
		})),
	};
}

async function createFixtureBundle(baseDir, announceUrl) {
	const dataDir = join(baseDir, "data");
	const torrentsDir = join(baseDir, "torrents");
	const outputDir = join(baseDir, "output");
	const linkDir = join(baseDir, "links");
	const configDir = join(baseDir, "config");
	const manifestPath = join(baseDir, "manifest.json");

	await Promise.all(
		[dataDir, torrentsDir, outputDir, linkDir, configDir].map((dir) =>
			mkdir(dir, { recursive: true }),
		),
	);

	const entries = [
		{
			id: "episode-01",
			kind: "episode",
			title: "Show.Name.S01E01.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"tv",
						"Show.Name",
						"Season 01",
						"Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv",
					size: 128 * 1024,
				},
			],
		},
		{
			id: "episode-02",
			kind: "episode",
			title: "Show.Name.S01E02.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"tv",
						"Show.Name",
						"Season 01",
						"Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv",
					size: 132 * 1024,
				},
			],
		},
		{
			id: "episode-03",
			kind: "episode",
			title: "Show.Name.S01E03.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"tv",
						"Show.Name",
						"Season 01",
						"Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv",
					size: 136 * 1024,
				},
			],
		},
		{
			id: "episode-04",
			kind: "episode",
			title: "Show.Name.S01E04.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"tv",
						"Show.Name",
						"Season 01",
						"Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv",
					size: 140 * 1024,
				},
			],
		},
		{
			id: "season-pack",
			kind: "season-pack",
			title: "Show.Name.S01.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"packs",
						"Show.Name.S01.1080p.WEB-DL-GROUP",
						"Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv",
					size: 128 * 1024,
				},
				{
					relativeDiskPath: join(
						"packs",
						"Show.Name.S01.1080p.WEB-DL-GROUP",
						"Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv",
					size: 132 * 1024,
				},
				{
					relativeDiskPath: join(
						"packs",
						"Show.Name.S01.1080p.WEB-DL-GROUP",
						"Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv",
					size: 136 * 1024,
				},
				{
					relativeDiskPath: join(
						"packs",
						"Show.Name.S01.1080p.WEB-DL-GROUP",
						"Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv",
					size: 140 * 1024,
				},
			],
			torrentName: "Show.Name.S01.1080p.WEB-DL-GROUP",
		},
		{
			id: "movie-01",
			kind: "movie",
			title: "Movie.Name.2024.1080p.WEB-DL-GROUP",
			sourceFiles: [
				{
					relativeDiskPath: join(
						"movies",
						"Movie.Name.2024",
						"Movie.Name.2024.1080p.WEB-DL-GROUP.mkv",
					),
					torrentPath: "Movie.Name.2024.1080p.WEB-DL-GROUP.mkv",
					size: 192 * 1024,
				},
			],
		},
	];

	const seededEntries = [];
	for (const entry of entries) {
		const sourceFiles = entry.sourceFiles.map((file) => ({
			sourcePath: join(dataDir, file.relativeDiskPath),
			torrentPath: file.torrentPath,
			size: file.size,
		}));
		for (const file of sourceFiles) {
			await writeFixtureFile(
				file.sourcePath,
				file.size,
				file.torrentPath,
			);
		}

		const torrentName = entry.torrentName ?? entry.title;
		const torrentFileName = `[${entry.kind}][${DEFAULT_TRACKER}]${torrentName}[seed].torrent`;
		const torrentPath = join(torrentsDir, torrentFileName);
		const builtTorrent = await buildTorrentBuffer({
			name: torrentName,
			sourceFiles,
			announceUrl,
			pieceLength: DEFAULT_PIECE_LENGTH,
		});
		await writeFile(torrentPath, builtTorrent.torrentBuffer);

		seededEntries.push({
			id: entry.id,
			kind: entry.kind,
			title: entry.title,
			torrentName,
			tracker: DEFAULT_TRACKER,
			announceUrl,
			pieceLength: DEFAULT_PIECE_LENGTH,
			infoHash: builtTorrent.infoHash,
			size: builtTorrent.size,
			torrentPath,
			files: builtTorrent.files,
			dataPaths: sourceFiles.map((file) => file.sourcePath),
		});
	}

	const manifest = {
		createdAt: new Date().toISOString(),
		baseDir,
		configDir,
		dataDir,
		torrentsDir,
		outputDir,
		linkDir,
		announceUrl,
		torrents: seededEntries,
	};
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

	return {
		...manifest,
		manifestPath,
	};
}

export async function seedTestData(options = {}) {
	const baseDir = options.baseDir
		? resolve(options.baseDir)
		: await mkdtemp(join(tmpdir(), "cross-seed-test-data-"));
	const announceUrl = options.announceUrl ?? DEFAULT_ANNOUNCE_URL;
	return createFixtureBundle(baseDir, announceUrl);
}

const isMain =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
	if (hasFlag("help")) {
		printUsage();
		process.exit(0);
	}

	const manifest = await seedTestData({
		baseDir: getArg("base-dir"),
		announceUrl: getArg("announce-url"),
	});

	console.log(`Seeded local dev data at: ${resolve(manifest.baseDir)}`);
	console.log(`configDir: ${resolve(manifest.configDir)}`);
	console.log(`dataDir: ${resolve(manifest.dataDir)}`);
	console.log(`torrentsDir: ${resolve(manifest.torrentsDir)}`);
	console.log(`outputDir: ${resolve(manifest.outputDir)}`);
	console.log(`linkDir: ${resolve(manifest.linkDir)}`);
	console.log(`manifest: ${resolve(manifest.manifestPath)}`);
	for (const torrent of manifest.torrents) {
		const dataLabel =
			torrent.files.length === 1
				? resolve(torrent.dataPaths[0])
				: `${torrent.files.length} files in ${resolve(dirname(torrent.dataPaths[0]))}`;
		console.log(
			`- ${torrent.kind}: ${torrent.title} [${torrent.infoHash}] -> ${relative(manifest.baseDir, torrent.torrentPath)} (${dataLabel})`,
		);
	}
}
