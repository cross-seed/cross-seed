import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHybridTorrent } from "./support/hybridTorrent.js";

const root = await mkdtemp(join(tmpdir(), "cross-seed-source-paths-"));

describe.sequential("automatic source exclusions", () => {
	let db: typeof import("../src/db.js").db;
	let data: typeof import("../src/dataFiles.js");
	let runtime: typeof import("../src/runtimeConfig.js");
	let paths: typeof import("../src/sourcePaths.js");
	let logger: typeof import("../src/logger.js").logger;
	let dir: string;
	beforeEach(async () => {
		process.env.CONFIG_DIR = await mkdtemp(join(root, "config-"));
		vi.resetModules();
		({ db } = await import("../src/db.js"));
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		await db.migrate.latest();
		runtime = await import("../src/runtimeConfig.js");
		data = await import("../src/dataFiles.js");
		paths = await import("../src/sourcePaths.js");
		dir = await mkdtemp(join(root, "data-"));
		runtime.setRuntimeConfig({
			...config.getDefaultRuntimeConfig(),
			dataDirs: [dir],
			maxDataDepth: 4,
			useClientTorrents: false,
		});
	});
	afterEach(async () => {
		data.destroyDataDirWatchers();
		logger.close();
		await db.destroy();
		vi.restoreAllMocks();
		delete process.env.CONFIG_DIR;
	});

	it("excludes nested hardlinks from discovery, parents, matching and old indexes without deleting files", async () => {
		const season = join(dir, "Show.S01");
		const original = join(season, "Show.S01E01.mkv");
		const links = join(season, "links");
		const generated = join(links, "Show.S01E02.mkv");
		const symlinked = join(links, "Show.S01E03.mkv");
		await mkdir(links, { recursive: true });
		await writeFile(original, Buffer.alloc(10));
		await link(original, generated);
		await symlink(original, symlinked);
		await data.indexDataDirs({ startup: true });
		expect(
			await db<{ path: string }>("data").where({ path: generated }),
		).toHaveLength(1);
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			linkDirs: [links],
			seasonFromEpisodes: 0.5,
		});
		await data.indexDataDirs({ startup: true });
		expect(
			await db<{ path: string }>("data").where({ path: generated }),
		).toHaveLength(0);
		expect(
			await db("ensemble")
				.where({ path: generated })
				.whereNull("client_host"),
		).toHaveLength(0);
		expect(
			await db("library_item")
				.where({ path: generated })
				.whereNull("missing_since"),
		).toHaveLength(0);
		const parent = await db("library_item").where({ path: season }).first();
		expect(parent).toBeDefined();
		expect(JSON.parse(parent!.files)).toHaveLength(1);
		expect(parent!.length).toBe(10);
		const { getFilesFromDataRoot } = await import("../src/searchee.js");
		expect(
			await getFilesFromDataRoot(season, new Map(), new Map()),
		).toHaveLength(1);
		expect(await data.findSearcheesFromAllDataDirs()).not.toContain(
			generated,
		);
		expect(await readFile(generated)).toHaveLength(10);
	});

	it.each(["outputDir", "torrentDir"] as const)(
		"excludes a nested %s and preserves ordinary siblings",
		async (key) => {
			const output = join(dir, "metadata");
			await mkdir(output);
			await writeFile(join(output, "Generated.S01E01.mkv"), "generated");
			const original = join(dir, "Original.S01E01.mkv");
			await writeFile(original, "original");
			runtime.setRuntimeConfig({
				...runtime.getRuntimeConfig(),
				[key]: output,
			});
			await data.indexDataDirs({ startup: true });
			expect(
				(await db<{ path: string }>("data")).map((row) => row.path),
			).toEqual([original]);
		},
	);

	it("recognizes directory aliases and missing descendants without excluding similar prefixes", async () => {
		const links = join(dir, "links");
		await mkdir(links);
		const alias = join(root, `alias-${Date.now()}`);
		await symlink(links, alias);
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			linkDirs: [alias],
		});
		const include = await paths.createDataPathFilter();
		expect(await include(join(links, "future.mkv"))).toBe(false);
		expect(await include(join(dir, "links-other", "future.mkv"))).toBe(
			true,
		);
	});

	it.each(["same", "alias"])(
		"rejects exact %s link/source roots without changing settings",
		async (layout) => {
			const linkDir =
				layout === "same"
					? dir
					: join(dir, "..", `alias-${Date.now()}`);
			if (layout === "alias") await symlink(dir, linkDir);
			const { daemonSettingsService } =
				await import("../src/daemonSettings.js");
			const { setDbConfig } = await import("../src/dbConfig.js");
			await setDbConfig(runtime.getRuntimeConfig());
			const before = await db("settings").first();
			await expect(
				daemonSettingsService.patch({
					linkDirs: [linkDir],
					maxDataDepth: 2,
				}),
			).rejects.toThrow(/must differ/);
			expect(await db("settings").first()).toEqual(before);
			expect(runtime.getRuntimeConfig().maxDataDepth).toBe(4);
		},
	);

	it("allows a link root containing the source root without hiding original files", async () => {
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			linkDirs: [root],
		});
		await paths.validateSourceLayout(runtime.getRuntimeConfig());
		const original = join(dir, "Original.S01E01.mkv");
		await writeFile(original, "original");
		await data.indexDataDirs({ startup: true });
		expect(
			(await db<{ path: string }>("data")).map((row) => row.path),
		).toEqual([original]);
	});

	it("preserves an explicit source inside an excluded destination while skipping its generated siblings", async () => {
		const links = join(dir, "links");
		const originals = join(links, "Original.Show.S01");
		await mkdir(originals, { recursive: true });
		const original = join(originals, "Original.Show.S01E01.mkv");
		const generated = join(links, "Generated.Show.S01E01.mkv");
		await writeFile(original, "original");
		await writeFile(generated, "generated");
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			dataDirs: [dir, originals],
			linkDirs: [links],
		});
		await data.indexDataDirs({ startup: true });
		expect(
			await db<{ path: string }>("data").where({ path: original }),
		).toHaveLength(1);
		expect(
			await db<{ path: string }>("data").where({ path: generated }),
		).toHaveLength(0);
		const { getFilesFromDataRoot } = await import("../src/searchee.js");
		expect(
			await getFilesFromDataRoot(links, new Map(), new Map()),
		).toHaveLength(1);
	});

	it("keeps original metainfo in a shared output/torrent directory and ignores saved candidates", async () => {
		const torrent = await import("../src/torrent.js");
		const metadata = buildHybridTorrent().torrent;
		await writeFile(
			join(dir, "original.torrent"),
			new Uint8Array(metadata),
		);
		await writeFile(
			join(dir, "[episode][Tracker]Saved.torrent"),
			new Uint8Array(metadata),
		);
		runtime.setRuntimeConfig({
			...runtime.getRuntimeConfig(),
			outputDir: dir,
			torrentDir: dir,
		});
		expect(await torrent.loadTorrentDirLight(dir)).toHaveLength(1);
		await torrent.indexTorrentsAndDataDirs({ startup: true });
		expect(
			await db("library_item")
				.where({ source: "torrentFile" })
				.whereNull("missing_since"),
		).toHaveLength(1);
		expect(
			await readFile(join(dir, "[episode][Tracker]Saved.torrent")),
		).toEqual(metadata);
	});
});
