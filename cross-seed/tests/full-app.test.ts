import {
	mkdtemp,
	mkdir,
	readdir,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createInjectedFetch } from "./support/injectedFetch.js";
import { createMockTorznabServer } from "./support/mockTorznab.js";

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
	getInfoHashesToExclude: typeof import("../src/torrent.js").getInfoHashesToExclude;
	getTorrentByCriteria: typeof import("../src/torrent.js").getTorrentByCriteria;
	Metafile: typeof import("../src/parseTorrent.js").Metafile;
};

let cleanupRuntime: (() => Promise<void>) | undefined;

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
		getInfoHashesToExclude,
		getTorrentByCriteria,
	} = await import("../src/torrent.js");
	const { Metafile } = await import("../src/parseTorrent.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	initializePushNotifier();
	await db.migrate.latest();
	const { destroyDataDirWatchers } = await import("../src/dataFiles.js");
	cleanupRuntime = async () => {
		destroyDataDirWatchers();
		await db.destroy();
	};

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
		getInfoHashesToExclude,
		getTorrentByCriteria,
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

	afterEach(async () => {
		await cleanupRuntime?.();
		cleanupRuntime = undefined;
	});

	beforeEach(() => {
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
	});

	it("persists indexed dataDir items in library inventory", async () => {
		const env = await createRuntimeEnv();
		const dataDir = join(TEST_ROOT, "library-data", "data");
		const outputDir = join(TEST_ROOT, "library-data", "output");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		const fileName = "Library.Show.S01E01.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		const fileSize = 1024 * 32;
		await writeFile(filePath, Buffer.alloc(fileSize));

		applyConfig(env, {
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			includeSingleEpisodes: true,
		});

		await env.indexTorrentsAndDataDirs({ startup: true });

		const dataRows = await env.db("data");
		const libraryRows = await env.db("library_item").where({
			source: "dataDir",
			source_instance: dataDir,
		});
		const libraryFileRows = await env.db("library_file").where({
			source: "dataDir",
			source_instance: dataDir,
		});

		expect(dataRows).toHaveLength(1);
		expect(libraryRows).toHaveLength(1);
		expect(libraryFileRows).toHaveLength(1);
		expect(libraryRows[0]).toMatchObject({
			source_key: `dataDir:${filePath}`,
			path: filePath,
			name: fileName,
			title: fileName,
			length: fileSize,
			missing_since: null,
		});
		expect(libraryFileRows[0]).toMatchObject({
			item_source_key: `dataDir:${filePath}`,
			path: fileName,
			name: fileName,
			length: fileSize,
			missing_since: null,
		});

		await env.indexTorrentsAndDataDirs({ startup: true });
		const latestScan = await env
			.db("library_scan")
			.where({
				source: "dataDir",
				source_instance: dataDir,
			})
			.orderBy("id", "desc")
			.first();
		expect(latestScan).toMatchObject({
			items_seen: 1,
			items_upserted: 0,
			items_removed: 0,
		});
	});

	it("preserves unavailable directory inventory and recovers without restart", async () => {
		const env = await createRuntimeEnv();
		const dataDir = join(TEST_ROOT, "recovery-data");
		const healthyDir = join(TEST_ROOT, "healthy-data");
		await mkdir(dataDir);
		await mkdir(healthyDir);
		const filePath = join(dataDir, "Recovery.Show.S01E01.mkv");
		await writeFile(filePath, Buffer.alloc(1024));
		applyConfig(env, {
			dataDirs: [dataDir, healthyDir],
			useClientTorrents: false,
		});
		await env.indexTorrentsAndDataDirs({ startup: true });
		await rename(dataDir, `${dataDir}.offline`);
		await writeFile(
			join(healthyDir, "Healthy.Show.S01E01.mkv"),
			Buffer.alloc(1024),
		);
		await expect(
			env.indexTorrentsAndDataDirs({ startup: true }),
		).resolves.toBeUndefined();
		expect(
			await env.db("library_item").whereNull("missing_since"),
		).toHaveLength(2);
		const failedScan = await env
			.db("library_scan")
			.where({ source_instance: dataDir })
			.orderBy("id", "desc")
			.first();
		expect(failedScan).toMatchObject({ status: "failed" });
		expect(failedScan?.error).toContain("ENOENT");
		await rename(`${dataDir}.offline`, dataDir);
		await unlink(filePath);
		await env.indexTorrentsAndDataDirs();
		expect(
			(
				await env
					.db("library_item")
					.where({ source_instance: dataDir })
					.first()
			)?.missing_since,
		).toBeTypeOf("number");
		expect(
			await env
				.db("library_scan")
				.where({ source_instance: dataDir })
				.orderBy("id", "desc")
				.first(),
		).toMatchObject({ status: "succeeded", items_seen: 0 });
		expect(
			await env
				.db("library_item")
				.where({ source_instance: healthyDir })
				.whereNull("missing_since"),
		).toHaveLength(1);
	});

	it("persists indexed torrentDir items in library inventory", async () => {
		const env = await createRuntimeEnv();
		const torrentDir = join(TEST_ROOT, "library-torrent", "torrents");
		const outputDir = join(TEST_ROOT, "library-torrent", "output");
		await mkdir(torrentDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		torznab.state.setTorrents([
			{
				id: "library-torrent",
				title: "Library.Show.S01E02.1080p.WEB-DL-GROUP",
				torrentName: "Library.Show.S01E02.1080p.WEB-DL-GROUP",
				files: [
					{
						path: "Library.Show.S01E02.1080p.WEB-DL-GROUP.mkv",
						length: 1024 * 64,
					},
				],
				tracker: "mock-torznab",
			},
		]);
		const normalizedTorrent = torznab.state.resolveTorrents()[0];
		const meta = env.Metafile.decode(normalizedTorrent.torrentPayload);
		const torrentPath = join(torrentDir, `${meta.infoHash}.torrent`);
		await writeFile(torrentPath, meta.encode());

		applyConfig(env, {
			dataDirs: [],
			outputDir,
			torrentDir,
			useClientTorrents: false,
			includeSingleEpisodes: true,
			seasonFromEpisodes: 1,
		});

		await env.indexTorrentsAndDataDirs({ startup: true });

		const libraryRows = await env.db("library_item").where({
			source: "torrentFile",
			source_instance: torrentDir,
		});

		expect(libraryRows).toHaveLength(1);
		expect(libraryRows[0]).toMatchObject({
			source_key: `torrentFile:${torrentPath}`,
			path: torrentPath,
			info_hash: meta.infoHash,
			name: meta.name,
			title: "Library.Show.S01E02.1080p.WEB-DL-GROUP",
			length: meta.length,
			missing_since: null,
		});
		const torrentStat = await stat(torrentPath);
		expect(libraryRows[0].content_fingerprint).toBe(
			JSON.stringify({
				path: torrentPath,
				size: torrentStat.size,
				mtimeMs: torrentStat.mtimeMs,
			}),
		);
		expect(await env.db("torrent")).toHaveLength(0);
		await expect(env.getInfoHashesToExclude()).resolves.toContain(
			meta.infoHash,
		);
		await expect(
			env.getTorrentByCriteria({ infoHash: meta.infoHash }),
		).resolves.toMatchObject([
			{
				infoHash: meta.infoHash,
				path: torrentPath,
			},
		]);

		await env.indexTorrentsAndDataDirs({ startup: true });
		const latestScan = await env
			.db("library_scan")
			.where({
				source: "torrentFile",
				source_instance: torrentDir,
			})
			.orderBy("id", "desc")
			.first();
		expect(latestScan).toMatchObject({
			items_seen: 1,
			items_upserted: 0,
			items_removed: 0,
		});
	});

	it("records a failed torrent directory scan without deleting its inventory", async () => {
		const env = await createRuntimeEnv();
		const torrentDir = join(TEST_ROOT, "offline-torrents");
		await mkdir(torrentDir);
		const { syncLibraryItems, LibraryItemSource } =
			await import("../src/libraryInventory.js");
		await syncLibraryItems({
			source: LibraryItemSource.TORRENT,
			sourceInstance: torrentDir,
			itemsToUpsert: [
				{
					source: LibraryItemSource.TORRENT,
					sourceInstance: torrentDir,
					sourceKey: `torrentFile:${torrentDir}/old.torrent`,
					path: `${torrentDir}/old.torrent`,
					name: "Old",
					title: "Old",
					length: 1,
					files: [],
				},
			],
		});
		await rename(torrentDir, `${torrentDir}.offline`);
		applyConfig(env, {
			torrentDir,
			dataDirs: [],
			useClientTorrents: false,
		});
		await env.indexTorrentsAndDataDirs({ startup: true });
		expect(
			await env.db("library_item").whereNull("missing_since"),
		).toHaveLength(1);
		expect(
			await env.db("library_scan").orderBy("id", "desc").first(),
		).toMatchObject({ status: "failed" });
		await rename(`${torrentDir}.offline`, torrentDir);
		await env.indexTorrentsAndDataDirs();
		expect(
			await env.db("library_item").whereNull("missing_since"),
		).toHaveLength(0);
		expect(
			await env.db("library_scan").orderBy("id", "desc").first(),
		).toMatchObject({ status: "succeeded" });
	});

	it("distinguishes client disconnection from a successful empty torrent list", async () => {
		const env = await createRuntimeEnv();
		const { default: QBittorrent } =
			await import("../src/clients/QBittorrent.js");
		const client = new QBittorrent(
			"http://localhost:8080",
			"localhost:8080",
			0,
			false,
		);
		const { updateSearcheeClientDB } = await import("../src/searchee.js");
		await updateSearcheeClientDB(
			client.clientHost,
			[
				{
					clientHost: client.clientHost,
					infoHash: "a".repeat(40),
					name: "Old",
					title: "Old",
					files: [],
					length: 1,
					savePath: "/data",
					trackers: [],
				},
			],
			new Set(["a".repeat(40)]),
		);
		applyConfig(env, { useClientTorrents: true, dataDirs: [] });
		env.setClientsForTesting([client]);
		const list = vi
			.spyOn(client, "getAllTorrentInfo")
			.mockRejectedValue(new Error("Disconnected"));
		await env.indexTorrentsAndDataDirs({ startup: true });
		expect(
			await env.db("library_item").whereNull("missing_since"),
		).toHaveLength(1);
		expect(
			await env.db("library_scan").orderBy("id", "desc").first(),
		).toMatchObject({ status: "failed", error: "Disconnected" });
		list.mockResolvedValue([]);
		await env.indexTorrentsAndDataDirs();
		expect(
			await env.db("library_item").whereNull("missing_since"),
		).toHaveLength(0);
		expect(await env.db("client_searchee")).toHaveLength(0);
		expect(
			await env.db("library_scan").orderBy("id", "desc").first(),
		).toMatchObject({ status: "succeeded" });
		list.mockRestore();
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

		const normalizedTorrent = torznab.state.resolveTorrents()[0];
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
		// Successful injection removes the input after completion is confirmed.
		// That cleanup runs in the background when injectDir is not set.
		await expect.poll(() => readdir(outputDir)).toEqual([]);
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

		const normalizedTorrent = torznab.state.resolveTorrents()[0];
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
	});
});
