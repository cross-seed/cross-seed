import ms from "ms";
import { Action } from "./constants.js";
import { cleanupDB, db } from "./db.js";
import { exitOnCrossSeedErrors } from "./errors.js";
import { injectSavedTorrents } from "./inject.js";
import { Label, logger } from "./logger.js";
import { bulkSearch, scanRssFeeds } from "./pipeline.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import { updateCaps } from "./torznab.js";
import { humanReadableDate, Mutex, withMutex } from "./utils.js";

export enum JobName {
	RSS = "rss",
	SEARCH = "search",
	UPDATE_INDEXER_CAPS = "updateIndexerCaps",
	INJECT = "inject",
	CLEANUP = "cleanup",
}

const jobs: Job[] = [];

class Job {
	name: JobName;
	cadence: number;
	exec: () => Promise<void>;
	isActive: boolean;
	runAheadOfSchedule: boolean;
	delayNextRun: boolean;
	configOverride: Partial<RuntimeConfig>;
	shouldRunFn: () => boolean;

	constructor(
		name: JobName,
		cadence: number,
		exec: () => Promise<void>,
		shouldRunFn: () => boolean = () => true,
	) {
		this.name = name;
		this.cadence = cadence;
		this.exec = exec;
		this.isActive = false;
		this.runAheadOfSchedule = false;
		this.delayNextRun = false;
		this.configOverride = {};
		this.shouldRunFn = shouldRunFn;
	}

	shouldRun(): boolean {
		return this.shouldRunFn();
	}

	async run(): Promise<boolean> {
		if (this.isActive) return false;
		this.isActive = true;
		try {
			logger.info({
				label: Label.SCHEDULER,
				message: `starting job: ${this.name}`,
			});
			if (this.runAheadOfSchedule && this.name === JobName.SEARCH) {
				await bulkSearch({ configOverride: this.configOverride });
			} else if (
				this.runAheadOfSchedule &&
				this.name === JobName.CLEANUP
			) {
				await cleanupDB({ runAll: true });
			} else {
				await this.exec();
			}
		} finally {
			this.isActive = false;
			this.runAheadOfSchedule = false;
			this.configOverride = {};
		}
		return true;
	}
}

function createJobs(): void {
	const { action, rssCadence, searchCadence } = getRuntimeConfig();
	if (rssCadence) {
		jobs.push(
			new Job(
				JobName.RSS,
				rssCadence,
				scanRssFeeds,
				() => !!getRuntimeConfig().rssCadence,
			),
		);
	}
	if (searchCadence) {
		jobs.push(
			new Job(
				JobName.SEARCH,
				searchCadence,
				bulkSearch,
				() => !!getRuntimeConfig().searchCadence,
			),
		);
	}
	jobs.push(new Job(JobName.UPDATE_INDEXER_CAPS, ms("1 day"), updateCaps));
	if (action === Action.INJECT) {
		jobs.push(new Job(JobName.INJECT, ms("1 hour"), injectSavedTorrents));
	}
	jobs.push(new Job(JobName.CLEANUP, ms("1 day"), cleanupDB));
}

export function getJobs(): Job[] {
	return jobs;
}

function logNextRun(
	name: string,
	cadence: number,
	lastRun: number | undefined | null,
) {
	const now = Date.now();

	const eligibilityTs = lastRun ? lastRun + cadence : now;

	const lastRunStr = !lastRun
		? "never"
		: now >= lastRun
			? `${ms(now - lastRun)} ago`
			: `at ${humanReadableDate(lastRun - cadence)}`;
	const nextRunStr =
		now >= eligibilityTs ? "now" : `in ${ms(eligibilityTs - now)}`;

	logger.info({
		label: Label.SCHEDULER,
		message: `${name}: last run ${lastRunStr}, next run ${nextRunStr}`,
	});
}

export async function getJobLastRun(
	name: JobName,
): Promise<number | undefined> {
	return (await db("job_log").select("last_run").where({ name }).first())
		?.last_run;
}

export async function checkJobs(
	options = { isFirstRun: false, useQueue: false },
): Promise<void> {
	return withMutex(
		Mutex.CHECK_JOBS,
		{ useQueue: options.useQueue },
		async () => {
			const now = Date.now();
			for (const job of jobs) {
				if (!job.shouldRun()) {
					continue;
				}

				const lastRun = await getJobLastRun(job.name);
				const eligibilityTs = lastRun ? lastRun + job.cadence : now;
				if (options.isFirstRun) {
					logNextRun(job.name, job.cadence, lastRun);
				}

				if (!job.runAheadOfSchedule) {
					if (jobs.find((j) => j.name === JobName.RSS)?.isActive) {
						continue;
					}
					if (job.name === JobName.CLEANUP) {
						if (jobs.some((j) => j.isActive)) continue;
					}
				}

				if (job.runAheadOfSchedule || now >= eligibilityTs) {
					job.run()
						.then(async (didRun) => {
							if (!didRun) return; // upon success, update the log
							const toDelay = job.delayNextRun;
							job.delayNextRun = false;
							const last_run = toDelay ? now + job.cadence : now;
							await db("job_log")
								.insert({ name: job.name, last_run })
								.onConflict("name")
								.merge();
							const cadence = toDelay
								? job.cadence * 2
								: job.cadence;
							logNextRun(job.name, cadence, now);
						})
						.catch(exitOnCrossSeedErrors)
						.catch((e) => void logger.error(e));
				}
			}
		},
	);
}

export async function jobsLoop(): Promise<void> {
	createJobs();

	setInterval(checkJobs, ms("1 minute"));
	await checkJobs({ isFirstRun: true, useQueue: false });
	// jobs take too long to run to completion so let process.exit take care of stopping
	return new Promise(() => {});
}
