import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../src/runtimeConfig.js";
import {
	createFakeTorrentClientServer,
	FakeTorrentClient,
} from "./support/fakeTorrentClient.js";
import { createMockTorznabServer } from "./support/mockTorznab.js";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-empty-source-"));
process.env.CONFIG_DIR = join(TEST_ROOT, "config");

// CONFIG_DIR must be set before the app modules are loaded, so these cannot be
// static imports.
const configuration = await import("../src/configuration.js");
configuration.createAppDirHierarchy();
const logging = await import("../src/logger.js");
logging.initializeLogger({});
logging.logger.silent = true;
const { db } = await import("../src/db.js");
const { resetClientsForTesting, setClientsForTesting } =
	await import("../src/clients/TorrentClient.js");
const { Action, LinkType } = await import("../src/constants.js");
const { injectSavedTorrents } = await import("../src/inject.js");
const { Metafile } = await import("../src/parseTorrent.js");
const { initializePushNotifier } = await import("../src/pushNotifier.js");
const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
const { getMediaType } = await import("../src/searchee.js");
const { getTorrentSavePath } = await import("../src/torrent.js");

await db.migrate.latest();

const fakeTorrent = createFakeTorrentClientServer();
const torznab = createMockTorznabServer();

type LoggedMessage = { label?: string; message?: string };
type TorrentFile = { path: string; length: number };

function hasInjectError(calls: unknown[][]): boolean {
	return calls.some(
		([info]) => (info as LoggedMessage).label === logging.Label.INJECT,
	);
}

function countMessagesMentioning(calls: unknown[][], text: string): number {
	return calls.filter(([info]) =>
		((info as LoggedMessage).message ?? "").includes(text),
	).length;
}

function configure(overrides: Partial<RuntimeConfig>) {
	setRuntimeConfig({
		...configuration.getDefaultRuntimeConfig(),
		...overrides,
	});
	initializePushNotifier();
}

function configureInject(outputDir: string, linkDir: string) {
	configure({
		action: Action.INJECT,
		dataDirs: [],
		flatLinking: true,
		includeSingleEpisodes: true,
		linkDirs: [linkDir],
		linkType: LinkType.HARDLINK,
		outputDir,
		torrents: [],
		useClientTorrents: true,
	});
}

/** Writes a .torrent to outputDir with an age that makes it count as stalled. */
async function writeStalledTorrent(
	id: string,
	torrentName: string,
	torrentFiles: TorrentFile[],
	outputDir: string,
) {
	torznab.state.setTorrents([
		{
			id,
			title: torrentName,
			torrentName,
			files: torrentFiles,
			tracker: "mock-torznab",
		},
	]);
	const resolved = torznab.state.resolveTorrents()[0];
	const meta = Metafile.decode(resolved.torrentPayload);
	const torrentPath = getTorrentSavePath(
		meta,
		getMediaType(meta),
		resolved.tracker,
		outputDir,
		{ cached: false },
	);
	await writeFile(torrentPath, meta.encode());
	const stalledAt = new Date(Date.now() - 2 * 86_400_000);
	await utimes(torrentPath, stalledAt, stalledAt);
	return { meta, torrentPath };
}

describe("injecting from stalled sources", () => {
	beforeEach(() => {
		fakeTorrent.state.reset();
		resetClientsForTesting();
	});

	afterAll(async () => {
		await fakeTorrent.server.close();
		await torznab.server.close();
		logging.logger.close();
		await db.destroy();
		delete process.env.CONFIG_DIR;
		await rm(TEST_ROOT, { recursive: true, force: true });
	});

	it("defers the injection until the source has files, then injects", async () => {
		const sourceDir = join(TEST_ROOT, "source-data");
		const outputDir = join(TEST_ROOT, "output");
		const linkDir = join(TEST_ROOT, "links");
		await mkdir(sourceDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });
		await mkdir(linkDir, { recursive: true });

		const fileName = "Show.Name.S01E05.1080p.WEB-DL-GROUP.mkv";
		const fileSize = 1024 * 128;
		const source = {
			infoHash: "a".repeat(40),
			name: fileName,
			savePath: sourceDir,
			files: [{ path: fileName, length: fileSize }],
		};
		// Stopped at 0%: the client knows the torrent, but nothing is on disk.
		fakeTorrent.state.addTorrent({ ...source, complete: false });
		const { meta, torrentPath } = await writeStalledTorrent(
			"1",
			fileName,
			[{ path: fileName, length: fileSize }],
			outputDir,
		);
		expect(meta.infoHash).not.toBe(source.infoHash);

		configureInject(outputDir, linkDir);
		const client = new FakeTorrentClient(fakeTorrent.server);
		setClientsForTesting([client]);
		const injectSpy = vi.spyOn(client, "inject");
		const errorSpy = vi.spyOn(logging.logger, "error");

		try {
			await injectSavedTorrents();

			// No linking, no error, and the saved torrent is kept for a retry.
			expect(injectSpy).not.toHaveBeenCalled();
			expect(fakeTorrent.state.torrents.has(meta.infoHash)).toBe(false);
			expect(await readdir(linkDir)).toEqual([]);
			expect(hasInjectError(errorSpy.mock.calls)).toBe(false);
			const outputFiles = await readdir(outputDir);
			expect(outputFiles).toEqual([basename(torrentPath)]);

			// The source starts downloading: its file appears and it completes.
			await writeFile(join(sourceDir, fileName), Buffer.alloc(fileSize));
			fakeTorrent.state.addTorrent({ ...source, complete: true });

			await injectSavedTorrents();

			expect(injectSpy).toHaveBeenCalledTimes(1);
			const injected = fakeTorrent.state.torrents.get(meta.infoHash);
			expect(injected?.complete).toBe(true);
			await expect.poll(() => readdir(outputDir)).toEqual([]);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("still injects from a stalled source that has some of its files", async () => {
		const sourceDir = join(TEST_ROOT, "partial-data");
		const outputDir = join(TEST_ROOT, "partial-output");
		const linkDir = join(TEST_ROOT, "partial-links");
		await mkdir(sourceDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });
		await mkdir(linkDir, { recursive: true });

		const rootFolder = "Show.Name.S01E06.1080p.WEB-DL-GROUP";
		const fileName = "Show.Name.S01E06.1080p.WEB-DL-GROUP.mkv";
		const sampleName = "Show.Name.S01E06.sample.mkv";
		// The .torrent's file list is relative to the torrent name, while the
		// client's paths include the root folder.
		const torrentFiles = [
			{ path: fileName, length: 1024 * 64 },
			{ path: sampleName, length: 1024 * 16 },
		];
		const presentFile = `${rootFolder}/${fileName}`;
		const missingFile = `${rootFolder}/${sampleName}`;
		const source = {
			infoHash: "b".repeat(40),
			name: rootFolder,
			savePath: sourceDir,
			files: [
				{ path: presentFile, length: torrentFiles[0].length },
				{ path: missingFile, length: torrentFiles[1].length },
			],
		};
		// Incomplete, but the main file has been downloaded.
		await mkdir(join(sourceDir, rootFolder), { recursive: true });
		await writeFile(
			join(sourceDir, presentFile),
			Buffer.alloc(torrentFiles[0].length),
		);
		fakeTorrent.state.addTorrent({ ...source, complete: false });
		const { meta, torrentPath } = await writeStalledTorrent(
			"2",
			rootFolder,
			torrentFiles,
			outputDir,
		);

		configureInject(outputDir, linkDir);
		const client = new FakeTorrentClient(fakeTorrent.server);
		setClientsForTesting([client]);
		const injectSpy = vi.spyOn(client, "inject");
		const errorSpy = vi.spyOn(logging.logger, "error");
		const warnSpy = vi.spyOn(logging.logger, "warn");

		try {
			await injectSavedTorrents();

			expect(injectSpy).toHaveBeenCalledTimes(1);
			expect(fakeTorrent.state.torrents.has(meta.infoHash)).toBe(true);
			const sourceStat = await stat(join(sourceDir, presentFile));
			const linkedStat = await stat(join(linkDir, presentFile));
			expect(linkedStat.ino).toBe(sourceStat.ino);
			expect(linkedStat.dev).toBe(sourceStat.dev);
			const linked = await readdir(join(linkDir, rootFolder));
			expect(linked).toEqual([basename(presentFile)]);
			expect(
				countMessagesMentioning(
					warnSpy.mock.calls,
					"using stalled source",
				),
			).toBe(1);
			expect(hasInjectError(errorSpy.mock.calls)).toBe(false);
			// Stalled injections keep the saved torrent for the inject job.
			expect(await readdir(outputDir)).toEqual([basename(torrentPath)]);
		} finally {
			errorSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});

	it("keeps the error path when the source root cannot be read", async () => {
		const parentDir = join(TEST_ROOT, "unreadable-root-data");
		const outputDir = join(TEST_ROOT, "unreadable-root-output");
		const linkDir = join(TEST_ROOT, "unreadable-root-links");
		await mkdir(parentDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });
		await mkdir(linkDir, { recursive: true });

		const rootFolder = "Show.Name.S01E07.1080p.WEB-DL-GROUP";
		const torrentFiles: TorrentFile[] = [
			{
				path: "Show.Name.S01E07.1080p.WEB-DL-GROUP.mkv",
				length: 1024 * 64,
			},
			{ path: "Show.Name.S01E07.sample.mkv", length: 1024 * 16 },
		];
		// A self-referencing symlink makes stat() of the save path fail with
		// ELOOP, standing in for a permission or mount failure rather than an
		// absent source.
		const sourceDir = join(parentDir, "downloads");
		await symlink("downloads", sourceDir);
		fakeTorrent.state.addTorrent({
			infoHash: "c".repeat(40),
			name: rootFolder,
			savePath: sourceDir,
			files: torrentFiles.map((file) => ({
				path: `${rootFolder}/${file.path}`,
				length: file.length,
			})),
			complete: false,
		});
		const { torrentPath } = await writeStalledTorrent(
			"3",
			rootFolder,
			torrentFiles,
			outputDir,
		);

		configureInject(outputDir, linkDir);
		const client = new FakeTorrentClient(fakeTorrent.server);
		setClientsForTesting([client]);
		const injectSpy = vi.spyOn(client, "inject");
		const errorSpy = vi.spyOn(logging.logger, "error");

		try {
			await injectSavedTorrents();

			// Unreadable is not the same as "no downloaded files": the linking
			// error is still reported instead of silently deferring.
			expect(injectSpy).not.toHaveBeenCalled();
			expect(
				countMessagesMentioning(errorSpy.mock.calls, "Linking failed"),
			).toBeGreaterThan(0);
			expect(await readdir(outputDir)).toEqual([basename(torrentPath)]);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("keeps the normal path when a source file cannot be read", async () => {
		const sourceDir = join(TEST_ROOT, "unreadable-file-data");
		const outputDir = join(TEST_ROOT, "unreadable-file-output");
		const linkDir = join(TEST_ROOT, "unreadable-file-links");
		await mkdir(sourceDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });
		await mkdir(linkDir, { recursive: true });

		const rootFolder = "Show.Name.S01E08.1080p.WEB-DL-GROUP";
		const torrentFiles: TorrentFile[] = [
			{
				path: "Show.Name.S01E08.1080p.WEB-DL-GROUP.mkv",
				length: 1024 * 64,
			},
			{ path: "Show.Name.S01E08.sample.mkv", length: 1024 * 16 },
		];
		await mkdir(join(sourceDir, rootFolder), { recursive: true });
		// The first listed file cannot be stat()ed (ELOOP); the others are
		// simply missing.
		await symlink(
			torrentFiles[0].path,
			join(sourceDir, rootFolder, torrentFiles[0].path),
		);
		fakeTorrent.state.addTorrent({
			infoHash: "d".repeat(40),
			name: rootFolder,
			savePath: sourceDir,
			files: torrentFiles.map((file) => ({
				path: `${rootFolder}/${file.path}`,
				length: file.length,
			})),
			complete: false,
		});
		const { meta } = await writeStalledTorrent(
			"4",
			rootFolder,
			torrentFiles,
			outputDir,
		);

		configureInject(outputDir, linkDir);
		const client = new FakeTorrentClient(fakeTorrent.server);
		setClientsForTesting([client]);
		const injectSpy = vi.spyOn(client, "inject");
		const errorSpy = vi.spyOn(logging.logger, "error");

		try {
			await injectSavedTorrents();

			// An unreadable file doesn't prove the source has no files, so the
			// stalled injection is still attempted.
			expect(injectSpy).toHaveBeenCalledTimes(1);
			expect(fakeTorrent.state.torrents.has(meta.infoHash)).toBe(true);
			expect(hasInjectError(errorSpy.mock.calls)).toBe(false);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
