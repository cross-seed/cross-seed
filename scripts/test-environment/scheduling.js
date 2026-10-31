import assert from "node:assert/strict";
import { createEnvironment, eventually } from "./daemon.js";

/** Observe the running daemon's scheduler through HTTP and the online CLI. */
export async function runSchedulingScenario(report = () => {}) {
	const env = await createEnvironment();
	try {
		await env.start();
		await env.trpc(
			"auth.setup",
			{
				username: "scheduler-admin",
				password: "environment-test-password",
			},
			true,
		);
		await env.trpc(
			"settings.save",
			{
				rssCadence: 0,
				searchCadence: 0,
				action: "save",
				useClientTorrents: false,
			},
			true,
		);
		await eventually("initialized scheduler", async () =>
			(await env.trpc("jobs.getJobStatuses")).some(
				(job) => job.name === "cleanup",
			),
		);
		await env.trpc(
			"settings.save",
			{ rssCadence: 1, searchCadence: 1, action: "inject" },
			true,
		);
		let jobs = await env.trpc("jobs.getJobStatuses");
		assert.equal(
			jobs.find((job) => job.name === "rss").interval,
			"10 minutes",
		);
		assert.equal(
			jobs.find((job) => job.name === "search").interval,
			"1 day",
		);
		assert.ok(jobs.some((job) => job.name === "inject"));
		assert.equal((await env.trpc("settings.get")).config.rssCadence, 1);
		await env.trpc("settings.save", { rssCadence: 3600000 }, true);
		jobs = await env.trpc("jobs.getJobStatuses");
		assert.equal(jobs.filter((job) => job.name === "rss").length, 1);
		assert.equal(jobs.find((job) => job.name === "rss").interval, "1 hour");
		await env.trpc(
			"settings.save",
			{ rssCadence: 0, searchCadence: 0, action: "save" },
			true,
		);
		jobs = await env.trpc("jobs.getJobStatuses");
		assert.ok(
			jobs.every(
				(job) => !["rss", "search", "inject"].includes(job.name),
			),
		);
		report(
			"HTTP changes enabled, bounded, updated and disabled jobs immediately without rewriting stored cadence values",
		);
		const result = await env.cli("config", "set", "--rss-cadence", "1");
		assert.match(result.stderr, /Saved and applied by the running daemon/);
		jobs = await env.trpc("jobs.getJobStatuses");
		assert.equal(
			jobs.find((job) => job.name === "rss").interval,
			"10 minutes",
		);
		await env.stop();
		await env.start();
		await eventually(
			"scheduler after restart",
			async () =>
				(await env.trpc("jobs.getJobStatuses")).find(
					(job) => job.name === "rss",
				)?.interval === "10 minutes",
		);
		report(
			"Online CLI changes applied live; restart retained the same internal scheduling safeguards",
		);
	} catch (error) {
		throw new Error(`${error.message}\nDaemon output:\n${env.output}`, {
			cause: error,
		});
	} finally {
		await env.close();
	}
}
