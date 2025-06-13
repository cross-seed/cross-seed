import { z } from "zod";
import ms from "ms";
import { router, authedProcedure } from "../index.js";
import { getJobs, getJobLastRun, JobName, checkJobs } from "../../jobs.js";
import { Label, logger } from "../../logger.js";
import { humanReadableDate } from "../../utils.js";
import { db } from "../../db.js";

type JobStatus = {
	name: JobName;
	interval: string;
	lastExecution: string | null;
	lastDuration: string | null;
	nextExecution: string;
	isActive: boolean;
	canRunNow: boolean;
};

export const jobsRouter = router({
	// Get all job statuses
	getJobStatuses: authedProcedure.query(async () => {
		const jobs = getJobs();
		const now = Date.now();

		// Fetch all job last run times in a single query
		const jobNames = jobs.map((job) => job.name);
		const lastRunData = await db("job_log")
			.select("name", "last_run")
			.whereIn("name", jobNames);

		// Create a map for quick lookups
		const lastRunMap = new Map(
			lastRunData.map((row) => [row.name, row.last_run]),
		);

		const jobStatuses: JobStatus[] = jobs.map((job) => {
			const lastRun = lastRunMap.get(job.name);
			const eligibilityTs = lastRun ? lastRun + job.cadence : now;

			// Format interval (cadence) as human readable
			const interval = ms(job.cadence, { long: true });

			// Format last execution - return timestamp for frontend to format
			const lastExecution = lastRun
				? new Date(lastRun).toISOString()
				: null;

			// Format next execution - return timestamp for frontend to format
			const nextExecution =
				now >= eligibilityTs
					? "now"
					: new Date(eligibilityTs).toISOString();

			// Check if job can run now (not active and eligible for early run)
			// Jobs can run "ahead of schedule" if current time >= lastRun time
			// Note: lastRun can be in the future when delayNextRun was used
			const canRunNow =
				!job.isActive && (lastRun === undefined || now >= lastRun);

			return {
				name: job.name,
				interval,
				lastExecution,
				lastDuration: null, // TODO: Add duration tracking in future
				nextExecution,
				isActive: job.isActive,
				canRunNow,
			};
		});

		return jobStatuses;
	}),

	// Trigger a job to run ahead of schedule
	triggerJob: authedProcedure
		.input(
			z.object({
				name: z.nativeEnum(JobName),
			}),
		)
		.mutation(async ({ input }) => {
			const jobs = getJobs();
			const job = jobs.find((j) => j.name === input.name);

			if (!job) {
				throw new Error(
					`${input.name}: unable to run, disabled in config`,
				);
			}

			if (job.isActive) {
				throw new Error(`${job.name}: already running`);
			}

			const lastRun = (await getJobLastRun(job.name)) ?? 0;
			if (Date.now() < lastRun) {
				throw new Error(
					`${job.name}: not eligible to run ahead of schedule, next scheduled run is at ${humanReadableDate(lastRun + job.cadence)} (triggering an early run is allowed after ${humanReadableDate(lastRun)})`,
				);
			}

			job.runAheadOfSchedule = true;
			if (job.name === JobName.SEARCH || job.name === JobName.RSS) {
				job.delayNextRun = true;
			}

			// Clear any config overrides for manual runs
			job.configOverride = {};

			void checkJobs({ isFirstRun: false, useQueue: true });

			logger.info({
				label: Label.SCHEDULER,
				message: `${job.name}: running ahead of schedule via web UI`,
			});

			return {
				success: true,
				message: `${job.name}: running ahead of schedule`,
			};
		}),
});
