import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/trpc/index.js";

const root = await mkdtemp(join(tmpdir(), "cross-seed-scheduler-settings-"));

describe.sequential("automatic scheduling policy and live settings", () => {
	let jobs: typeof import("../src/jobs.js");
	let runtime: typeof import("../src/runtimeConfig.js");
	let db: typeof import("../src/db.js").db;
	let logger: typeof import("../src/logger.js").logger;
	let caller: ReturnType<
		typeof import("../src/trpc/routers/index.js").appRouter.createCaller
	>;
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
		const initial = {
			...config.getDefaultRuntimeConfig(),
			useClientTorrents: false,
			rssCadence: 0,
			searchCadence: 0,
			action: (await import("../src/constants.js")).Action.SAVE,
		};
		runtime.setRuntimeConfig(initial);
		await (await import("../src/dbConfig.js")).setDbConfig(initial);
		jobs = await import("../src/jobs.js");
		const { appRouter } = await import("../src/trpc/routers/index.js");
		caller = appRouter.createCaller({
			user: { id: 1, username: "test" },
			setSession: vi.fn(),
			deleteSession: vi.fn(),
		} as unknown as Context);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		logger.close();
		await db.destroy();
		delete process.env.CONFIG_DIR;
	});

	it("enables, updates and disables jobs live without duplicates or clearing history", async () => {
		jobs.reconcileJobs(true);
		expect(jobs.getJobs().map((job) => job.name)).not.toContain(
			jobs.JobName.RSS,
		);
		await db("job_log").insert({ name: jobs.JobName.RSS, last_run: 1234 });
		await caller.settings.save({
			rssCadence: 1,
			searchCadence: 1,
			action: "inject",
		});
		const rss = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.RSS)!;
		expect(rss.cadence).toBe(600_000);
		expect(
			jobs.getJobs().find((job) => job.name === jobs.JobName.SEARCH)
				?.cadence,
		).toBe(86_400_000);
		expect(
			jobs.getJobs().some((job) => job.name === jobs.JobName.INJECT),
		).toBe(true);
		await caller.settings.save({ rssCadence: 3_600_000 });
		expect(
			jobs.getJobs().find((job) => job.name === jobs.JobName.RSS),
		).toBe(rss);
		expect(rss.cadence).toBe(3_600_000);
		await caller.settings.save({ rssCadence: 1_000_000_000 });
		expect(rss.cadence).toBe(7_200_000);
		expect(
			jobs.getJobs().filter((job) => job.name === jobs.JobName.RSS),
		).toHaveLength(1);
		expect(await jobs.getJobLastRun(jobs.JobName.RSS)).toBe(1234);
		await caller.settings.save({
			rssCadence: 0,
			searchCadence: 0,
			action: "save",
		});
		expect(jobs.getJobs().map((job) => job.name)).toEqual([
			jobs.JobName.UPDATE_INDEXER_CAPS,
			jobs.JobName.CLEANUP,
		]);
	});

	it("retains an active job across disable/re-enable and prevents concurrent runs", async () => {
		await caller.settings.save({ rssCadence: 600_000 });
		jobs.reconcileJobs(true);
		const rss = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.RSS)!;
		let release!: () => void;
		rss.exec = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const running = rss.run();
		await caller.settings.save({ rssCadence: 0 });
		expect(rss.shouldRun()).toBe(false);
		await expect(
			caller.jobs.triggerJob({ name: jobs.JobName.RSS }),
		).rejects.toThrow(/disabled/);
		await caller.settings.save({ rssCadence: 600_000 });
		expect(
			jobs.getJobs().find((job) => job.name === jobs.JobName.RSS),
		).toBe(rss);
		expect(await rss.run()).toBe(false);
		release();
		await running;
		expect(rss.exec).toHaveBeenCalledOnce();
	});

	it("backs off failed automatic work and still permits an explicit manual retry", async () => {
		jobs.reconcileJobs(true);
		const cleanup = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.CLEANUP)!;
		const exec = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValue(undefined);
		cleanup.exec = exec;
		jobs.getJobs().splice(0, jobs.getJobs().length, cleanup);
		await expect(cleanup.run()).rejects.toThrow("temporary failure");
		await jobs.checkJobs();
		expect(exec).toHaveBeenCalledOnce();
		await caller.jobs.triggerJob({ name: jobs.JobName.CLEANUP });
		await vi.waitFor(async () =>
			expect(
				await jobs.getJobLastRun(jobs.JobName.CLEANUP),
			).toBeDefined(),
		);
		expect(exec).toHaveBeenCalledTimes(2);
	});

	it("measures failure backoff from completion of a long-running attempt", async () => {
		jobs.reconcileJobs(true);
		const job = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.CLEANUP)!;
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		job.exec = () => {
			clock.mockReturnValue(now + 3_600_000);
			return Promise.reject(new Error("late failure"));
		};
		await expect(job.run()).rejects.toThrow("late failure");
		expect(jobs.getJobNextRun(job, undefined)).toBe(now + 3_900_000);
		clock.mockRestore();
	});

	it("does not start newly enabled work while cleanup is active", async () => {
		jobs.reconcileJobs(true);
		const cleanup = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.CLEANUP)!;
		let release!: () => void;
		cleanup.exec = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		const running = cleanup.run();
		await caller.settings.save({ rssCadence: 600_000 });
		const rss = jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.RSS)!;
		const exec = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		rss.exec = exec;
		await jobs.checkJobs();
		expect(exec).not.toHaveBeenCalled();
		release();
		await running;
	});

	it("bounds repeat searches internally without overwriting the stored filters", async () => {
		const pipeline = await import("../src/pipeline.js");
		const search = vi
			.spyOn(pipeline, "bulkSearch")
			.mockResolvedValue(undefined);
		await caller.settings.save({
			searchCadence: 1,
			excludeRecentSearch: 1,
		});
		jobs.reconcileJobs(true);
		await jobs
			.getJobs()
			.find((job) => job.name === jobs.JobName.SEARCH)!
			.run();
		expect(search).toHaveBeenCalledWith({
			configOverride: { excludeRecentSearch: 86_400_000 },
		});
		expect((await caller.settings.get()).config.excludeRecentSearch).toBe(
			1,
		);
	});

	it("applies webhook changes to the active notifier immediately", async () => {
		const notifications = await import("../src/pushNotifier.js");
		await caller.settings.save({
			notificationWebhookUrls: ["http://127.0.0.1:9999/first"],
		});
		expect(notifications.pushNotifier.entries).toEqual([
			"http://127.0.0.1:9999/first",
		]);
		await caller.settings.save({ notificationWebhookUrls: [] });
		expect(notifications.pushNotifier.entries).toEqual([]);
	});
});
