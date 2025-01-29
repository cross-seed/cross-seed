import ms from "ms";
import { Action } from "./constants.js";
import { db } from "./db.js";
import { exitOnCrossSeedErrors } from "./errors.js";
import { injectSavedTorrents } from "./inject.js";
import { Label, logger } from "./logger.js";
import { bulkSearch, scanRssFeeds } from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { updateCaps } from "./torznab.js";
import { cleanupTorrentCache } from "./decide.js";

class Job {
	name: string;
	cadence: number;
	exec: () => Promise<void>;
	isActive: boolean;

	constructor(name, cadence, exec) {
		this.name = name;
		this.cadence = cadence;
		this.exec = exec;
		this.isActive = false;
	}

	async run(): Promise<boolean> {
		if (!this.isActive) {
			this.isActive = true;
			try {
				logger.info({
					label: Label.SCHEDULER,
					message: `starting job: ${this.name}`,
				});
				await this.exec();
			} finally {
				this.isActive = false;
			}
			return true;
		}
		return false;
	}
}

function getJobs(): Job[] {
	const { action, rssCadence, searchCadence, torznab } = getRuntimeConfig();
	const jobs: Job[] = [];
	if (rssCadence) jobs.push(new Job("rss", rssCadence, scanRssFeeds));
	if (searchCadence) jobs.push(new Job("search", searchCadence, bulkSearch));
	if (torznab.length > 0) {
		jobs.push(new Job("updateIndexerCaps", ms("1 day"), updateCaps));
	}
	if (action === Action.INJECT) {
		jobs.push(new Job("inject", ms("1 hour"), injectSavedTorrents));
	}
	jobs.push(new Job("cleanup", ms("1 day"), cleanupTorrentCache));
	return jobs;
}

function logNextRun(
	name: string,
	cadence: number,
	lastRun: number | undefined | null,
) {
	const now = Date.now();

	const eligibilityTs = lastRun ? lastRun + cadence : now;

	const lastRunStr = lastRun ? `${ms(now - lastRun)} ago` : "never";
	const nextRunStr =
		now >= eligibilityTs ? "now" : `in ${ms(eligibilityTs - now)}`;

	logger.info({
		label: Label.SCHEDULER,
		message: `${name}: last run ${lastRunStr}, next run ${nextRunStr}`,
	});
}

export async function jobsLoop(): Promise<void> {
	const jobs = getJobs();

	async function loop(isFirstRun = false) {
		const now = Date.now();
		for (const job of jobs) {
			const lastRun = (
				await db("job_log")
					.select("last_run")
					.where({ name: job.name })
					.first()
			)?.last_run;

			// if it's never been run, you are eligible immediately
			const eligibilityTs = lastRun ? lastRun + job.cadence : now;
			if (isFirstRun) logNextRun(job.name, job.cadence, lastRun);

			if (now >= eligibilityTs) {
				job.run()
					.then(async (didRun) => {
						if (didRun) {
							// upon success, update the log
							await db("job_log")
								.insert({ name: job.name, last_run: now })
								.onConflict("name")
								.merge();
							logNextRun(job.name, job.cadence, now);
						}
					})
					.catch(exitOnCrossSeedErrors)
					.catch((e) => void logger.error(e));
			}
		}
	}

	setInterval(loop, ms("1 minute"));
	await loop(true);
	// jobs take too long to run to completion so let process.exit take care of stopping
	return new Promise(() => {});
}
