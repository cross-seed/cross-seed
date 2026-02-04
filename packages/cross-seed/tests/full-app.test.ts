import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createMockTorznabServer } from "../../mock-torznab/server.js";
import { createInjectedFetch } from "./support/injectedFetch.js";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-tests-"));
process.env.CONFIG_DIR = join(TEST_ROOT, "config");

const { db } = await import("../src/db.js");
const { bulkSearch, scanRssFeeds } = await import("../src/pipeline.js");
const { getDefaultRuntimeConfig, createAppDirHierarchy } =
	await import("../src/configuration.js");
const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
const { createIndexer } = await import("../src/services/indexerService.js");
const { Action } = await import("../src/constants.js");
const { resetClientsForTesting, setClientsForTesting } =
	await import("../src/clients/TorrentClient.js");
const { getMediaType } = await import("../src/searchee.js");
const { initializeLogger } = await import("../src/logger.js");
const { initializePushNotifier } = await import("../src/pushNotifier.js");
const {
	getTorrentSavePath,
	parseMetadataFromFilename,
	snatchHistory,
	indexTorrentsAndDataDirs,
} = await import("../src/torrent.js");
const { Metafile } = await import("../src/parseTorrent.js");

const torznab = createMockTorznabServer({
	baseUrl: "http://mock-torznab.local",
});
const { createFakeTorrentClientServer, FakeTorrentClient } =
	await import("./support/fakeTorrentClient.js");
const fakeTorrent = createFakeTorrentClientServer();
const realFetch = globalThis.fetch;

async function resetDb() {
	const tables = [
		"indexer",
		"rss",
		"searchee",
		"timestamp",
		"decision",
		"torrent",
		"client_searchee",
		"data",
		"ensemble",
		"job_log",
		"settings",
		"session",
		"user",
	];
	for (const table of tables) {
		try {
			await db(table).del();
		} catch {
			// ignore missing tables in older migrations
		}
	}
	snatchHistory.clear();
}

function applyConfig(
	overrides: Partial<ReturnType<typeof getDefaultRuntimeConfig>>,
) {
	setRuntimeConfig({
		...getDefaultRuntimeConfig(),
		...overrides,
	});
	initializePushNotifier();
}

describe.sequential("full app flows", () => {
	beforeAll(async () => {
		await torznab.server.ready();
		await fakeTorrent.server.ready();
		createAppDirHierarchy();
		initializeLogger({ verbose: false });
		await db.migrate.latest();
		vi.stubGlobal(
			"fetch",
			createInjectedFetch({
				server: torznab.server,
				baseUrl: torznab.state.baseUrl,
				realFetch,
			}),
		);
	});

	beforeEach(async () => {
		await resetDb();
		resetClientsForTesting();
		torznab.state.setTorrents([]);
		fakeTorrent.state.reset();
	});

	afterAll(async () => {
		vi.stubGlobal("fetch", realFetch);
		await torznab.server.close();
		await fakeTorrent.server.close();
		await db.destroy();
		await rm(TEST_ROOT, { recursive: true, force: true });
	});

	it("saves cross-seeds during bulk search", async () => {
		const dataDir = join(TEST_ROOT, "search", "data");
		const outputDir = join(TEST_ROOT, "search", "output");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		const fileName = "Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		const fileSize = 1024 * 256;
		await writeFile(filePath, Buffer.alloc(fileSize));

		torznab.state.setTorrents([
			{
				id: "1",
				title: fileName.replace(/\.mkv$/, ""),
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
			},
		]);

		applyConfig({
			action: Action.SAVE,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			delay: 0,
			includeSingleEpisodes: true,
		});

		await createIndexer({
			name: "Mock",
			url: `${torznab.state.baseUrl}/api`,
			apikey: "test-key",
			enabled: true,
		});

		await bulkSearch();

		const outputFiles = await readdir(outputDir);
		expect(outputFiles.some((f) => f.endsWith(".torrent"))).toBe(true);
	});

	it("only processes new RSS candidates after last seen guid", async () => {
		const dataDir = join(TEST_ROOT, "rss", "data");
		const outputDir = join(TEST_ROOT, "rss", "output");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		const fileName = "Show.Name.S01E02.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		const fileSize = 1024 * 128;
		await writeFile(filePath, Buffer.alloc(fileSize));

		const now = Date.now();
		torznab.state.setNow(now);
		torznab.state.setTorrents([
			{
				id: "1",
				title: fileName.replace(/\.mkv$/, ""),
				torrentName: `${fileName.replace(/\.mkv$/, "")}.v1`,
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
				pubDate: new Date(now),
			},
			{
				id: "2",
				title: fileName.replace(/\.mkv$/, ""),
				torrentName: `${fileName.replace(/\.mkv$/, "")}.v2`,
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
				pubDate: new Date(now - 60_000),
			},
		]);

		applyConfig({
			action: Action.SAVE,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			includeSingleEpisodes: true,
		});

		const indexer = await createIndexer({
			name: "Mock",
			url: `${torznab.state.baseUrl}/api`,
			apikey: "test-key",
			enabled: true,
		});

		await indexTorrentsAndDataDirs({ startup: true });

		await scanRssFeeds();

		const afterFirst = (await readdir(outputDir)).filter((f) =>
			f.endsWith(".torrent"),
		).length;

		const row = await db("rss").where({ indexer_id: indexer.id }).first();
		expect(row?.last_seen_guid).toBe(`${torznab.state.baseUrl}/torrent/1`);

		torznab.state.setTorrents([
			{
				id: "3",
				title: fileName.replace(/\.mkv$/, ""),
				torrentName: `${fileName.replace(/\.mkv$/, "")}.v3`,
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
				pubDate: new Date(now + 30_000),
			},
			{
				id: "1",
				title: fileName.replace(/\.mkv$/, ""),
				torrentName: `${fileName.replace(/\.mkv$/, "")}.v1`,
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
				pubDate: new Date(now),
			},
		]);

		await scanRssFeeds();

		const afterSecond = (await readdir(outputDir)).filter((f) =>
			f.endsWith(".torrent"),
		).length;
		expect(afterSecond).toBe(afterFirst + 1);

		const updatedRow = await db("rss")
			.where({ indexer_id: indexer.id })
			.first();
		expect(updatedRow?.last_seen_guid).toBe(
			`${torznab.state.baseUrl}/torrent/3`,
		);
	});

	it("injects saved torrents into a fake client", async () => {
		const dataDir = join(TEST_ROOT, "inject", "data");
		const outputDir = join(TEST_ROOT, "inject", "output");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		const fileName = "Show.Name.S01E03.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		const fileSize = 1024 * 64;
		await writeFile(filePath, Buffer.alloc(fileSize));

		torznab.state.setTorrents([
			{
				id: "10",
				title: fileName.replace(/\.mkv$/, ""),
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
			},
		]);

		const normalizedTorrent = torznab.state.torrents[0];
		const meta = Metafile.decode(normalizedTorrent.torrentPayload);
		const torrentPath = getTorrentSavePath(
			meta,
			getMediaType(meta),
			normalizedTorrent.tracker,
			outputDir,
			{ cached: false },
		);
		await writeFile(torrentPath, meta.encode());

		applyConfig({
			action: Action.INJECT,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			includeSingleEpisodes: true,
		});

		const fakeClient = new FakeTorrentClient(fakeTorrent.server);
		setClientsForTesting([fakeClient]);

		const { injectSavedTorrents } = await import("../src/inject.js");
		await injectSavedTorrents();

		expect(fakeTorrent.state.torrents.has(meta.infoHash)).toBe(true);
		const savedFiles = await readdir(outputDir);
		const parsed = savedFiles
			.map((file) => parseMetadataFromFilename(file))
			.filter((entry) => entry.infoHash === meta.infoHash);
		expect(parsed.length).toBeGreaterThanOrEqual(1);
	});
});
