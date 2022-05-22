import ms from "ms";
import { db } from "./db.js";
import { main, scanRssFeeds } from "./pipeline.js";
import { exitOnCrossSeedErrors } from "./errors.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

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

	async run() {
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
		}
	}
}

const getJobs = () => {
	const { rssCadence, searchCadence } = getRuntimeConfig();
	return [
		rssCadence && new Job("rss", rssCadence, scanRssFeeds),
		searchCadence && new Job("search", searchCadence, main),
	].filter(Boolean);
};

export async function jobsLoop() {
	const jobs = getJobs();

	async function loop() {
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
			const lastRunStr = lastRun ? `${ms(now - lastRun)} ago` : "never";
			const nextRunStr = ms(eligibilityTs - now);
			logger.verbose({
				label: Label.SCHEDULER,
				message: `${job.name}: last run ${lastRunStr}, next run in ${nextRunStr}`,
			});

			if (now >= eligibilityTs) {
				job.run()
					.then(async () => {
						// upon success, update the log
						await db("job_log")
							.insert({ name: job.name, last_run: now })
							.onConflict("name")
							.merge();
					})
					.catch(exitOnCrossSeedErrors)
					.catch((e) => void logger.error(e));
			}
		}
	}

	const interval = setInterval(loop, ms("1 minute"));
	loop();
	return () => clearInterval(interval);
}
