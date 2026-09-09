import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/trpc/index.js";

const TEST_ROOT = await mkdtemp(
	join(tmpdir(), "cross-seed-settings-indexing-tests-"),
);

type SettingsIndexingEnv = {
	destroyDataDirWatchers: typeof import("../src/dataFiles.js").destroyDataDirWatchers;
	db: typeof import("../src/db.js").db;
	appRouter: typeof import("../src/trpc/routers/index.js").appRouter;
	Action: typeof import("../src/constants.js").Action;
};

async function createSettingsIndexingEnv(): Promise<SettingsIndexingEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { appRouter } = await import("../src/trpc/routers/index.js");
	const { Action } = await import("../src/constants.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	await db.migrate.latest();

	const { destroyDataDirWatchers } = await import("../src/dataFiles.js");
	return { db, appRouter, Action, destroyDataDirWatchers };
}

function createCaller(env: SettingsIndexingEnv) {
	return env.appRouter.createCaller({
		user: { id: 1, username: "tester" },
		setSession: vi.fn(),
		deleteSession: vi.fn(),
	} as unknown as Context);
}

describe.sequential("settings source indexing", () => {
	let env: SettingsIndexingEnv;

	beforeEach(async () => {
		env = await createSettingsIndexingEnv();
	});

	afterEach(async () => {
		env.destroyDataDirWatchers();
		await env.db.destroy();
	});

	it("starts library indexing after torrent source settings are saved", async () => {
		const dataDir = join(TEST_ROOT, "settings-save", "data");
		const outputDir = join(TEST_ROOT, "settings-save", "output");
		await mkdir(dataDir, { recursive: true });
		await mkdir(outputDir, { recursive: true });

		const fileName = "Settings.Show.S01E01.1080p.WEB-DL-GROUP.mkv";
		const filePath = join(dataDir, fileName);
		await writeFile(filePath, Buffer.alloc(1024));

		await createCaller(env).settings.save({
			action: env.Action.SAVE,
			dataDirs: [dataDir],
			outputDir,
			useClientTorrents: false,
			includeSingleEpisodes: true,
		});

		await vi.waitFor(async () => {
			const row = await env
				.db("library_item")
				.where({ source_key: `dataDir:${filePath}` })
				.first();
			expect(row).toMatchObject({
				source: "dataDir",
				source_instance: dataDir,
				path: filePath,
				missing_since: null,
			});
		});

		const scan = await env
			.db("library_scan")
			.where({ source: "dataDir", source_instance: dataDir })
			.first();
		expect(scan).toMatchObject({
			status: "succeeded",
			items_seen: 1,
			items_upserted: 1,
		});
	});
});
