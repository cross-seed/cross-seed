import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import type { RuntimeConfig } from "../src/runtimeConfig.js";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-books-tests-"));
const DATA_DIR = join(TEST_ROOT, "data");

type DataFiles = typeof import("../src/dataFiles.js");

async function loadWithConfig(
	config: Partial<RuntimeConfig>,
): Promise<DataFiles> {
	process.env.CONFIG_DIR = await mkdtemp(join(TEST_ROOT, "config-"));
	vi.resetModules();
	const { getDefaultRuntimeConfig } = await import("../src/configuration.js");
	const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
	setRuntimeConfig({
		...getDefaultRuntimeConfig(),
		dataDirs: [DATA_DIR],
		maxDataDepth: 2,
		includeNonVideos: false,
		...config,
	});
	return import("../src/dataFiles.js");
}

beforeAll(async () => {
	await mkdir(join(DATA_DIR, "Series", "Deeper"), { recursive: true });
	await mkdir(join(DATA_DIR, "Sample"), { recursive: true });
	await writeFile(join(DATA_DIR, "Movie.2020.mkv"), "v");
	await writeFile(join(DATA_DIR, "Comic.T01.cbz"), "b");
	await writeFile(join(DATA_DIR, "Novel.epub"), "b");
	await writeFile(join(DATA_DIR, "Shouting.EPUB"), "b");
	await writeFile(join(DATA_DIR, "readme.html"), "h");
	await writeFile(join(DATA_DIR, "notes.txt"), "t");
	await writeFile(join(DATA_DIR, "Series", "Series.T02.pdf"), "b");
	await writeFile(join(DATA_DIR, "Series", "Deeper", "Series.T03.pdf"), "b");
	await writeFile(join(DATA_DIR, "Sample", "Sample.epub"), "b");
});

afterAll(async () => {
	delete process.env.CONFIG_DIR;
	await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("standalone book files in dataDirs", () => {
	it("are searchees when includeNonVideos is enabled", async () => {
		const { findSearcheesFromAllDataDirs } = await loadWithConfig({
			includeNonVideos: true,
		});
		const found = await findSearcheesFromAllDataDirs();
		expect(found).toEqual(
			expect.arrayContaining([
				join(DATA_DIR, "Comic.T01.cbz"),
				join(DATA_DIR, "Novel.epub"),
				join(DATA_DIR, "Series", "Series.T02.pdf"),
				join(DATA_DIR, "Movie.2020.mkv"),
				join(DATA_DIR, "Series"),
			]),
		);
	});

	it("follow the other rules when includeNonVideos is enabled", async () => {
		const { findSearcheesFromAllDataDirs } = await loadWithConfig({
			includeNonVideos: true,
		});
		const found = await findSearcheesFromAllDataDirs();
		// .html is not a book torrent; extensions match case-sensitively, as
		// videos do; ignored folders and maxDataDepth still apply
		expect(found).not.toContain(join(DATA_DIR, "readme.html"));
		expect(found).not.toContain(join(DATA_DIR, "notes.txt"));
		expect(found).not.toContain(join(DATA_DIR, "Shouting.EPUB"));
		expect(found).not.toContain(join(DATA_DIR, "Sample", "Sample.epub"));
		expect(found).not.toContain(
			join(DATA_DIR, "Series", "Deeper", "Series.T03.pdf"),
		);
	});

	it("stay ignored when includeNonVideos is disabled", async () => {
		const { findSearcheesFromAllDataDirs } = await loadWithConfig({
			includeNonVideos: false,
		});
		const found = await findSearcheesFromAllDataDirs();
		expect(found).toContain(join(DATA_DIR, "Movie.2020.mkv"));
		expect(found).not.toContain(join(DATA_DIR, "Comic.T01.cbz"));
		expect(found).not.toContain(join(DATA_DIR, "Novel.epub"));
		expect(found).not.toContain(join(DATA_DIR, "Series", "Series.T02.pdf"));
	});

	it("are kept by the shared path heuristic used for indexing", async () => {
		const { shouldIgnorePathHeuristically } = await loadWithConfig({
			includeNonVideos: true,
		});
		expect(
			shouldIgnorePathHeuristically(join(DATA_DIR, "Novel.epub"), false),
		).toBe(false);
		expect(
			shouldIgnorePathHeuristically(join(DATA_DIR, "readme.html"), false),
		).toBe(true);
	});

	it("honour an includeNonVideos override, as a webhook sends", async () => {
		const { findPotentialNestedRoots } = await loadWithConfig({
			includeNonVideos: false,
		});
		const path = join(DATA_DIR, "Novel.epub");
		expect(await findPotentialNestedRoots(path, 2)).toEqual([]);
		expect(
			await findPotentialNestedRoots(path, 2, undefined, undefined, {
				includeNonVideos: true,
			}),
		).toEqual([path]);
		const folder = join(DATA_DIR, "Series");
		expect(
			await findPotentialNestedRoots(folder, 2, undefined, undefined, {
				includeNonVideos: true,
			}),
		).toContain(join(folder, "Series.T02.pdf"));
	});
});

describe.sequential("standalone book files in the data index", () => {
	let db: typeof import("../src/db.js").db;
	let data: typeof import("../src/dataFiles.js");
	let logger: typeof import("../src/logger.js").logger;
	let dir: string;
	beforeEach(async () => {
		process.env.CONFIG_DIR = await mkdtemp(join(TEST_ROOT, "config-"));
		vi.resetModules();
		({ db } = await import("../src/db.js"));
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		await db.migrate.latest();
		data = await import("../src/dataFiles.js");
		dir = await mkdtemp(join(TEST_ROOT, "index-"));
		await writeFile(join(dir, "Novel.epub"), "b");
		const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
		setRuntimeConfig({
			...config.getDefaultRuntimeConfig(),
			dataDirs: [dir],
			maxDataDepth: 2,
			includeNonVideos: true,
			useClientTorrents: false,
		});
	});
	afterEach(async () => {
		await data.destroyDataDirWatchers();
		logger.close();
		await db.destroy();
		delete process.env.CONFIG_DIR;
	});

	it("are indexed by a dataDir scan when includeNonVideos is enabled", async () => {
		await data.indexDataDirs({ startup: true });
		expect(
			await db<{ path: string }>("data").where({
				path: join(dir, "Novel.epub"),
			}),
		).toHaveLength(1);
	});
});
