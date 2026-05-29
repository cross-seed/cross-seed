import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/trpc/index.js";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-jobs-tests-"));

type JobsEnv = {
	db: typeof import("../src/db.js").db;
	appRouter: typeof import("../src/trpc/routers/index.js").appRouter;
	getJobs: typeof import("../src/jobs.js").getJobs;
	JobName: typeof import("../src/jobs.js").JobName;
	initializeLogger: typeof import("../src/logger.js").initializeLogger;
};

async function createJobsEnv(): Promise<JobsEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { appRouter } = await import("../src/trpc/routers/index.js");
	const { getJobs, JobName } = await import("../src/jobs.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	await db.migrate.latest();

	return { db, appRouter, getJobs, JobName, initializeLogger };
}

function createCaller(env: JobsEnv) {
	return env.appRouter.createCaller({
		user: { id: 1, username: "tester" },
		setSession: vi.fn(),
		deleteSession: vi.fn(),
	} as unknown as Context);
}

function addFakeJob(
	env: JobsEnv,
	overrides: Partial<ReturnType<JobsEnv["getJobs"]>[number]> = {},
) {
	const job = {
		name: env.JobName.UPDATE_INDEXER_CAPS,
		cadence: 86_400_000,
		exec: vi.fn(),
		isActive: false,
		runAheadOfSchedule: false,
		configOverride: {},
		shouldRun: () => true,
		run: vi.fn(() => Promise.resolve(true)),
		...overrides,
	};

	env.getJobs().push(
		job as unknown as ReturnType<JobsEnv["getJobs"]>[number],
	);
	return job;
}

describe.sequential("jobs router", () => {
	let env: JobsEnv;

	beforeEach(async () => {
		env = await createJobsEnv();
		env.getJobs().splice(0);
	});

	afterEach(async () => {
		await env.db.destroy();
	});

	it("allows an inactive job with a future last_run to be run from the web UI", async () => {
		const futureLastRun = Date.now() + 60_000;
		addFakeJob(env);
		await env.db("job_log").insert({
			name: env.JobName.UPDATE_INDEXER_CAPS,
			last_run: futureLastRun,
		});

		const statuses = await createCaller(env).jobs.getJobStatuses();

		expect(statuses).toMatchObject([
			{
				name: env.JobName.UPDATE_INDEXER_CAPS,
				canRunNow: true,
				isActive: false,
			},
		]);
	});

	it("triggers an inactive job even when its last_run is in the future", async () => {
		const job = addFakeJob(env);
		await env.db("job_log").insert({
			name: env.JobName.UPDATE_INDEXER_CAPS,
			last_run: Date.now() + 60_000,
		});

		const result = await createCaller(env).jobs.triggerJob({
			name: env.JobName.UPDATE_INDEXER_CAPS,
		});

		expect(result).toEqual({
			success: true,
			message: `${env.JobName.UPDATE_INDEXER_CAPS}: running ahead of schedule`,
		});
		expect(job.runAheadOfSchedule).toBe(true);
		await vi.waitFor(() => expect(job.run).toHaveBeenCalledTimes(1));
	});

	it("records manual RSS and search runs at the run time instead of delaying the next run", async () => {
		const beforeRun = Date.now();
		addFakeJob(env, { name: env.JobName.RSS, cadence: 86_400_000 });
		addFakeJob(env, { name: env.JobName.SEARCH, cadence: 86_400_000 });
		const caller = createCaller(env);

		await caller.jobs.triggerJob({ name: env.JobName.RSS });
		await caller.jobs.triggerJob({ name: env.JobName.SEARCH });

		await vi.waitFor(async () => {
			const rows = await env.db("job_log").select("name", "last_run");
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row.last_run).toBeGreaterThanOrEqual(beforeRun);
				expect(row.last_run).toBeLessThan(beforeRun + 86_400_000);
			}
		});
	});
});
