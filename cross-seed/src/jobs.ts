import ms from "ms";
import { runInBackground } from "./utils/background.js";
import { Action } from "./constants.js";
import { cleanupDB, db } from "./db.js";
import { injectSavedTorrents } from "./inject.js";
import { Label, logger, exitOnCrossSeedErrors } from "./logger.js";
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
let schedulerInitialized = false;
const FAILURE_RETRY_MS = ms("5 minutes");

class Job {
	name: JobName;
	cadence: number;
	exec: () => Promise<void>;
	isActive: boolean;
	lastAttempt?: number;
	lastFailure?: number;
	runAheadOfSchedule: boolean;
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
		this.configOverride = {};
		this.shouldRunFn = shouldRunFn;
	}

	shouldRun(): boolean {
		return this.shouldRunFn();
	}

	async run(): Promise<boolean> {
		if (this.isActive) return false;
		this.isActive = true;
		this.lastAttempt = Date.now();
		this.lastFailure = undefined;
		try {
			logger.info({
				label: Label.SCHEDULER,
				message: `starting job: ${this.name}`,
			});
			if (this.runAheadOfSchedule && this.name === JobName.SEARCH) {
				await bulkSearch({ configOverride: this.configOverride });
			} else {
				await this.exec();
			}
		} catch (error) {
			this.lastFailure = Date.now();
			throw error;
		} finally {
			this.isActive = false;
			this.runAheadOfSchedule = false;
			this.configOverride = {};
			reconcileJobs();
		}
		return true;
	}
}

function automaticCadence(
	value: number,
	minimum: number,
	maximum = Number.MAX_SAFE_INTEGER,
): number {
	return Number.isFinite(value) && value > 0
		? Math.min(maximum, Math.max(minimum, value))
		: minimum;
}

/** Update jobs in place so an active run cannot be replaced by another run. */
export function reconcileJobs(initialize = false): void {
	if (initialize) schedulerInitialized = true;
	if (!schedulerInitialized) return;
	const { action, rssCadence, searchCadence } = getRuntimeConfig();
	const desired = [
		...(rssCadence
			? [
					new Job(
						JobName.RSS,
						automaticCadence(
							rssCadence,
							ms("10 minutes"),
							ms("2 hours"),
						),
						scanRssFeeds,
						() => !!getRuntimeConfig().rssCadence,
					),
				]
			: []),
		...(searchCadence
			? [
					new Job(
						JobName.SEARCH,
						automaticCadence(searchCadence, ms("1 day")),
						() =>
							bulkSearch({
								configOverride: {
									excludeRecentSearch: Math.max(
										getRuntimeConfig()
											.excludeRecentSearch ?? 0,
										ms("1 day"),
									),
								},
							}),
						() => !!getRuntimeConfig().searchCadence,
					),
				]
			: []),
		new Job(JobName.UPDATE_INDEXER_CAPS, ms("1 day"), updateCaps),
		...(action === Action.INJECT
			? [
					new Job(
						JobName.INJECT,
						ms("1 hour"),
						injectSavedTorrents,
						() => getRuntimeConfig().action === Action.INJECT,
					),
				]
			: []),
		new Job(JobName.CLEANUP, ms("1 day"), cleanupDB),
	];
	for (const next of desired) {
		const current = jobs.find((job) => job.name === next.name);
		if (current) current.cadence = next.cadence;
		else jobs.push(next);
	}
	const order = new Map(desired.map((job, index) => [job.name, index]));
	jobs.sort(
		(a, b) =>
			(order.get(a.name) ?? desired.length) -
			(order.get(b.name) ?? desired.length),
	);
	for (let index = jobs.length - 1; index >= 0; index--) {
		const job = jobs[index];
		if (!job.isActive && !desired.some((next) => next.name === job.name))
			jobs.splice(index, 1);
	}
}

export function getJobNextRun(
	job: Job,
	lastRun: number | undefined | null,
	now = Date.now(),
): number {
	const attemptEligibility =
		job.lastFailure !== undefined
			? job.lastFailure + FAILURE_RETRY_MS
			: job.lastAttempt === undefined
				? 0
				: job.lastAttempt + job.cadence;
	return Math.max(lastRun ? lastRun + job.cadence : now, attemptEligibility);
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
			for (const job of [...jobs]) {
				if (!job.shouldRun()) {
					continue;
				}
				// Cleanup must stay isolated even when jobs are enabled live or
				// explicitly requested while another job is already running.
				if (
					job.name === JobName.CLEANUP &&
					jobs.some((j) => j.isActive)
				)
					continue;
				if (
					job.name !== JobName.CLEANUP &&
					jobs.some((j) => j.name === JobName.CLEANUP && j.isActive)
				)
					continue;

				const lastRun = await getJobLastRun(job.name);
				const eligibilityTs = getJobNextRun(job, lastRun, now);
				if (options.isFirstRun) {
					logNextRun(job.name, job.cadence, lastRun);
				}

				if (!job.runAheadOfSchedule) {
					if (jobs.find((j) => j.name === JobName.RSS)?.isActive) {
						continue;
					}
				}

				if (job.runAheadOfSchedule || now >= eligibilityTs) {
					job.run()
						.then(async (didRun) => {
							if (!didRun) return; // upon success, update the log
							await db("job_log")
								.insert({ name: job.name, last_run: now })
								.onConflict("name")
								.merge();
							logNextRun(job.name, job.cadence, now);
						})
						.catch(exitOnCrossSeedErrors)
						.catch((e) => void logger.error(e));
				}
			}
		},
	);
}

export async function jobsLoop(): Promise<void> {
	reconcileJobs(true);

	setInterval(() => runInBackground(checkJobs()), ms("1 minute"));
	await checkJobs({ isFirstRun: true, useQueue: false });
	// jobs take too long to run to completion so let process.exit take care of stopping
	return new Promise(() => {});
}
