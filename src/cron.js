import ms from "ms";
import { db } from "./db.js";
import { main, scanRssFeeds } from "./pipeline.js";
import { exitOnCrossSeedErrors } from "./errors.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

const getJobs = () => {
	const { rssCadence, searchCadence } = getRuntimeConfig();
	return [
		{ name: "rss", cadence: rssCadence, run: scanRssFeeds },
		{ name: "search", cadence: searchCadence, run: main },
	];
};

export async function jobsLoop() {
	const interval = setInterval(async () => {
		const now = Date.now();
		for (const { name, cadence, run } of getJobs()) {
			const lastRun = (
				await db("job_log").select("last_run").where({ name }).first()
			)?.last_run;

			if (!lastRun || lastRun + cadence < now) {
				logger.info({
					label: Label.SCHEDULER,
					message: `starting job: ${name}`,
				});
				run()
					.then(async () => {
						// upon success, update the log
						await db("job_log")
							.insert({ name, last_run: now })
							.onConflict("name")
							.merge();
					})
					.catch(exitOnCrossSeedErrors)
					.catch((e) => void logger.error(e));
			}
		}
	}, ms("1 minute"));
	return () => void clearInterval(interval);
}
