import { mkdtemp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
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

const torznab = createMockTorznabServer({
	baseUrl: "http://mock-torznab.local",
});
const { createFakeTorrentClientServer, FakeTorrentClient } =
	await import("./support/fakeTorrentClient.js");
const fakeTorrent = createFakeTorrentClientServer();
const realFetch = globalThis.fetch;

type RuntimeEnv = {
	db: typeof import("../src/db.js").db;
	bulkSearch: typeof import("../src/pipeline.js").bulkSearch;
	scanRssFeeds: typeof import("../src/pipeline.js").scanRssFeeds;
	getDefaultRuntimeConfig: typeof import("../src/configuration.js").getDefaultRuntimeConfig;
	setRuntimeConfig: typeof import("../src/runtimeConfig.js").setRuntimeConfig;
	createIndexer: typeof import("../src/services/indexerService.js").createIndexer;
	Action: typeof import("../src/constants.js").Action;
	LinkType: typeof import("../src/constants.js").LinkType;
	resetClientsForTesting: typeof import("../src/clients/TorrentClient.js").resetClientsForTesting;
	setClientsForTesting: typeof import("../src/clients/TorrentClient.js").setClientsForTesting;
	getMediaType: typeof import("../src/searchee.js").getMediaType;
	initializeLogger: typeof import("../src/logger.js").initializeLogger;
	initializePushNotifier: typeof import("../src/pushNotifier.js").initializePushNotifier;
	getTorrentSavePath: typeof import("../src/torrent.js").getTorrentSavePath;
	parseMetadataFromFilename: typeof import("../src/torrent.js").parseMetadataFromFilename;
	indexTorrentsAndDataDirs: typeof import("../src/torrent.js").indexTorrentsAndDataDirs;
	Metafile: typeof import("../src/parseTorrent.js").Metafile;
};

async function createRuntimeEnv(): Promise<RuntimeEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { bulkSearch, scanRssFeeds } = await import("../src/pipeline.js");
	const { getDefaultRuntimeConfig, createAppDirHierarchy } =
		await import("../src/configuration.js");
	const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
	const { createIndexer } = await import("../src/services/indexerService.js");
	const { Action, LinkType } = await import("../src/constants.js");
	const { resetClientsForTesting, setClientsForTesting } =
		await import("../src/clients/TorrentClient.js");
	const { getMediaType } = await import("../src/searchee.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { initializePushNotifier } = await import("../src/pushNotifier.js");
	const {
		getTorrentSavePath,
		parseMetadataFromFilename,
		indexTorrentsAndDataDirs,
	} = await import("../src/torrent.js");
	const { Metafile } = await import("../src/parseTorrent.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	initializePushNotifier();
	await db.migrate.latest();

	return {
		db,
		bulkSearch,
		scanRssFeeds,
		getDefaultRuntimeConfig,
		setRuntimeConfig,
		createIndexer,
		Action,
		LinkType,
		resetClientsForTesting,
		setClientsForTesting,
		getMediaType,
		initializeLogger,
		initializePushNotifier,
		getTorrentSavePath,
		parseMetadataFromFilename,
		indexTorrentsAndDataDirs,
		Metafile,
	};
}

function applyConfig(
	env: RuntimeEnv,
	overrides: Partial<ReturnType<RuntimeEnv["getDefaultRuntimeConfig"]>>,
) {
	env.setRuntimeConfig({
		...env.getDefaultRuntimeConfig(),
		...overrides,
	});
	env.initializePushNotifier();
}

describe.sequential("full app flows", () => {
	beforeAll(async () => {
		await torznab.server.ready();
		await fakeTorrent.server.ready();
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
		torznab.state.setTorrents([]);
		fakeTorrent.state.reset();
	});

	afterAll(async () => {
		vi.stubGlobal("fetch", realFetch);
		await torznab.server.close();
		await fakeTorrent.server.close();
	});

	it("saves cross-seeds during bulk search", async () => {
		const env = await createRuntimeEnv();
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

		applyConfig(env, {
			action: env.Action.SAVE,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			delay: 0,
			includeSingleEpisodes: true,
		});

		await env.createIndexer({
			name: "Mock",
			url: `${torznab.state.baseUrl}/api`,
			apikey: "test-key",
			enabled: true,
		});

		await env.bulkSearch();

		const outputFiles = await readdir(outputDir);
		expect(outputFiles.some((f) => f.endsWith(".torrent"))).toBe(true);

		await env.db.destroy();
	});

	it("only processes new RSS candidates after last seen guid", async () => {
		const env = await createRuntimeEnv();
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

		applyConfig(env, {
			action: env.Action.SAVE,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			includeSingleEpisodes: true,
		});

		const indexer = await env.createIndexer({
			name: "Mock",
			url: `${torznab.state.baseUrl}/api`,
			apikey: "test-key",
			enabled: true,
		});

		await env.indexTorrentsAndDataDirs({ startup: true });
		await env.scanRssFeeds();

		const afterFirst = (await readdir(outputDir)).filter((f) =>
			f.endsWith(".torrent"),
		).length;

		const row = await env
			.db("rss")
			.where({ indexer_id: indexer.id })
			.first();
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

		await env.scanRssFeeds();

		const afterSecond = (await readdir(outputDir)).filter((f) =>
			f.endsWith(".torrent"),
		).length;
		expect(afterSecond).toBe(afterFirst + 1);

		const updatedRow = await env
			.db("rss")
			.where({ indexer_id: indexer.id })
			.first();
		expect(updatedRow?.last_seen_guid).toBe(
			`${torznab.state.baseUrl}/torrent/3`,
		);

		await env.db.destroy();
	});

	it("injects saved torrents into a fake client", async () => {
		const env = await createRuntimeEnv();
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
		const meta = env.Metafile.decode(normalizedTorrent.torrentPayload);
		const torrentPath = env.getTorrentSavePath(
			meta,
			env.getMediaType(meta),
			normalizedTorrent.tracker,
			outputDir,
			{ cached: false },
		);
		await writeFile(torrentPath, meta.encode());

		applyConfig(env, {
			action: env.Action.INJECT,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [],
			includeSingleEpisodes: true,
		});

		const fakeClient = new FakeTorrentClient(fakeTorrent.server);
		env.setClientsForTesting([fakeClient]);

		const { injectSavedTorrents } = await import("../src/inject.js");
		await injectSavedTorrents();

		expect(fakeTorrent.state.torrents.has(meta.infoHash)).toBe(true);
		const savedFiles = await readdir(outputDir);
		const parsed = savedFiles
			.map((file) => env.parseMetadataFromFilename(file))
			.filter((entry) => entry.infoHash === meta.infoHash);
		expect(parsed.length).toBeGreaterThanOrEqual(1);

		await env.db.destroy();
	});

	it("hardlinks files when linkDirs are configured", async () => {
		const env = await createRuntimeEnv();
		const dataDir = join(TEST_ROOT, "hardlink", "data");
		const outputDir = join(TEST_ROOT, "hardlink", "output");
		const linkDir = join(TEST_ROOT, "hardlink", "links");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });
		await mkdir(linkDir, { recursive: true });

		const fileName = "Show.Name.S01E04.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		const fileSize = 1024 * 128;
		await writeFile(filePath, Buffer.alloc(fileSize));

		torznab.state.setTorrents([
			{
				id: "20",
				title: fileName.replace(/\.mkv$/, ""),
				torrentName: fileName,
				files: [{ path: fileName, length: fileSize }],
				tracker: "mock-torznab",
			},
		]);

		const normalizedTorrent = torznab.state.torrents[0];
		const meta = env.Metafile.decode(normalizedTorrent.torrentPayload);
		const torrentPath = env.getTorrentSavePath(
			meta,
			env.getMediaType(meta),
			normalizedTorrent.tracker,
			outputDir,
			{ cached: false },
		);
		await writeFile(torrentPath, meta.encode());

		applyConfig(env, {
			action: env.Action.INJECT,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			linkDirs: [linkDir],
			linkType: env.LinkType.HARDLINK,
			flatLinking: true,
			includeSingleEpisodes: true,
		});

		const fakeClient = new FakeTorrentClient(fakeTorrent.server);
		env.setClientsForTesting([fakeClient]);

		const { injectSavedTorrents } = await import("../src/inject.js");
		await injectSavedTorrents();

		const linkedPath = join(linkDir, meta.files[0].path);
		const sourceStat = await stat(filePath);
		const linkedStat = await stat(linkedPath);
		expect(linkedStat.ino).toBe(sourceStat.ino);
		expect(linkedStat.dev).toBe(sourceStat.dev);

		await env.db.destroy();
	});
});
