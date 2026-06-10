import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/trpc/index.js";

const TEST_ROOT = await mkdtemp(
	join(tmpdir(), "cross-seed-library-router-tests-"),
);

type LibraryRouterEnv = {
	db: typeof import("../src/db.js").db;
	appRouter: typeof import("../src/trpc/routers/index.js").appRouter;
	inventory: typeof import("../src/libraryInventory.js");
};

async function createLibraryRouterEnv(): Promise<LibraryRouterEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { appRouter } = await import("../src/trpc/routers/index.js");
	const inventory = await import("../src/libraryInventory.js");

	createAppDirHierarchy();
	await db.migrate.latest();

	return { db, appRouter, inventory };
}

function createCaller(env: LibraryRouterEnv) {
	return env.appRouter.createCaller({
		user: { id: 1, username: "tester" },
		setSession: vi.fn(),
		deleteSession: vi.fn(),
	} as unknown as Context);
}

describe.sequential("library router", () => {
	let env: LibraryRouterEnv;

	beforeEach(async () => {
		env = await createLibraryRouterEnv();
	});

	afterEach(async () => {
		await env.db.destroy();
	});

	it("lists active inventory items with optional file details", async () => {
		const dataSourceKey =
			env.inventory.createDataLibrarySourceKey("/media/show");
		const dataItem = {
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			sourceKey: dataSourceKey,
			path: "/media/show",
			name: "Show",
			title: "Show S01",
			files: [
				{
					name: "episode.mkv",
					path: "show/episode.mkv",
					length: 100,
				},
			],
			length: 100,
			contentFingerprint: "data-fingerprint",
		};
		await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			itemsToUpsert: [dataItem],
			filesToUpsert: env.inventory.createLibraryFileInputs(dataItem),
			now: 1_000,
		});
		await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.CLIENT,
			sourceInstance: "client-a",
			itemsToUpsert: [
				{
					source: env.inventory.LibraryItemSource.CLIENT,
					sourceInstance: "client-a",
					sourceKey: env.inventory.createClientLibrarySourceKey({
						clientHost: "client-a",
						infoHash: "hash-a",
					}),
					clientHost: "client-a",
					infoHash: "hash-a",
					name: "Client Show",
					title: "Client Show S01",
					files: [],
					length: 200,
				},
			],
			now: 1_500,
		});

		const result = await createCaller(env).library.listItems({
			source: env.inventory.LibraryItemSource.DATA,
			includeFiles: true,
		});

		expect(result).toMatchObject({
			total: 1,
			limit: 50,
			offset: 0,
			items: [
				{
					source: env.inventory.LibraryItemSource.DATA,
					sourceInstance: "/media",
					sourceKey: dataSourceKey,
					path: "/media/show",
					name: "Show",
					title: "Show S01",
					length: 100,
					contentFingerprint: "data-fingerprint",
					fileCount: 1,
					files: [
						{
							path: "show/episode.mkv",
							name: "episode.mkv",
							length: 100,
						},
					],
				},
			],
		});
		expect(result.items[0].lastSeenAt).toBe("1970-01-01T00:00:01.000Z");
	});

	it("returns the latest scan status with active inventory counts", async () => {
		const item = {
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			sourceKey: env.inventory.createDataLibrarySourceKey("/media/show"),
			path: "/media/show",
			name: "Show",
			title: "Show S01",
			files: [
				{
					name: "episode.mkv",
					path: "show/episode.mkv",
					length: 100,
				},
			],
			length: 100,
		};
		await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			itemsToUpsert: [item],
			filesToUpsert: env.inventory.createLibraryFileInputs(item),
			now: 1_000,
		});
		await env.inventory.syncLibraryItems({
			source: env.inventory.LibraryItemSource.DATA,
			sourceInstance: "/media",
			sourceKeysSeen: [item.sourceKey],
			now: 2_000,
		});

		const statuses = await createCaller(env).library.getScanStatuses({
			source: env.inventory.LibraryItemSource.DATA,
		});

		expect(statuses).toMatchObject([
			{
				source: env.inventory.LibraryItemSource.DATA,
				sourceInstance: "/media",
				status: env.inventory.LibraryScanStatus.SUCCEEDED,
				startedAt: "1970-01-01T00:00:02.000Z",
				finishedAt: "1970-01-01T00:00:02.000Z",
				error: null,
				itemsSeen: 1,
				itemsUpserted: 0,
				itemsRemoved: 0,
				activeItems: 1,
				activeFiles: 1,
			},
		]);
	});
});
