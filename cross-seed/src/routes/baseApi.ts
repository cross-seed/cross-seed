import { Hono } from "hono";
import type { HttpEnv } from "../httpTypes.js";
import { runInBackground } from "../utils/background.js";
import chalk from "chalk";
import { existsSync } from "fs";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { z } from "zod";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	SaveResult,
} from "../constants.js";
import { checkJobs, getJobs, JobName } from "../jobs.js";
import { Label, logger } from "../logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "../pipeline.js";
import { getRuntimeConfig, RuntimeConfig } from "../runtimeConfig.js";
import { indexTorrentsAndDataDirs } from "../torrent.js";
import { errorMessage, formatAsList, sanitizeInfoHash } from "../utils.js";
import { authorize, API_KEY_REQUIRED } from "../utils/authUtils.js";

export const ANNOUNCE_SCHEMA = z
	.object({
		name: z
			.string()
			.transform((name) => name.trim())
			.refine((name) => name.length > 0),
		guid: z.string().url(),
		link: z.string().url(),
		tracker: z
			.string()
			.transform((tracker) => tracker.trim())
			.refine((tracker) => tracker.length > 0),
		cookie: z
			.string()
			.nullish()
			.transform((cookie) => cookie?.trim() || undefined),
	})
	.strict()
	.refine((data) => data.guid === data.link);

const WEBHOOK_SCHEMA = z
	.object({
		infoHash: z.string().length(40),
		path: z.string().refine((path) => path && existsSync(path)),
		ignoreCrossSeeds: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		ignoreExcludeRecentSearch: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		ignoreExcludeOlder: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		ignoreBlockList: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		includeSingleEpisodes: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		includeNonVideos: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
	})
	.strict()
	.partial()
	.refine((data) => !data.infoHash !== !data.path);

const JOB_SCHEMA = z
	.object({
		name: z.string(),
		ignoreExcludeRecentSearch: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
		ignoreExcludeOlder: z
			.boolean()
			.or(z.string().transform((v) => v === "true")),
	})
	.strict()
	.partial()
	.refine((data) => Object.values(JobName).includes(data.name as JobName));

function parseData(data: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data) as unknown;
	} catch {
		parsed = qsParse(data);
	}

	// transformations
	try {
		const obj = parsed as Record<string, unknown>;
		if ("infoHash" in obj && typeof obj.infoHash === "string") {
			obj.infoHash = obj.infoHash.toLowerCase();
		}
		if ("size" in obj && typeof obj.size === "string") {
			obj.size = Number(obj.size);
		}
	} catch {
		throw new Error(`Unable to parse request body: "${data}"`);
	}

	return parsed;
}

function determineResponse(result: {
	decision: DecisionAnyMatch | Decision.INFO_HASH_ALREADY_EXISTS | null;
	actionResult: ActionResult | null;
}): { status: number; state: string } {
	const injected = result.actionResult === InjectionResult.SUCCESS;
	const added =
		injected ||
		result.actionResult === InjectionResult.FAILURE ||
		result.actionResult === SaveResult.SAVED;
	const exists =
		result.decision === Decision.INFO_HASH_ALREADY_EXISTS ||
		result.actionResult === InjectionResult.ALREADY_EXISTS;
	const incomplete =
		result.actionResult === InjectionResult.TORRENT_NOT_COMPLETE;

	let status: number;
	let state: string;
	if (added) {
		status = 200;
		state = injected ? "Injected" : "Saved";
	} else if (exists) {
		status = 200;
		state = "Already exists";
	} else if (incomplete) {
		status = 202;
		state = "Saved";
	} else {
		throw new Error(
			`Unexpected result: ${result.decision} | ${result.actionResult}`,
		);
	}
	return { status, state };
}

export function baseApiRoutes(
	trackBackground: (task: Promise<void>) => void = runInBackground,
): Hono<HttpEnv> {
	const app = new Hono<HttpEnv>();
	for (const path of ["/webhook", "/announce", "/job"]) {
		app.post(path, async (c, next) => {
			const text = await c.req.text();
			const type = c.req
				.header("content-type")
				?.split(";")[0]
				.trim()
				.toLowerCase();
			if (text || type) {
				if (
					type === "application/json" ||
					type === "application/x-www-form-urlencoded"
				) {
					try {
						c.set("parsedBody", parseData(text));
					} catch (error) {
						return c.json(
							{
								statusCode: 500,
								error: "Internal Server Error",
								message: errorMessage(error),
							},
							500,
						);
					}
				} else if (type === "text/plain") c.set("parsedBody", text);
				else
					return c.json(
						{
							statusCode: 415,
							code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
							error: "Unsupported Media Type",
							message: `Unsupported Media Type: ${type}`,
						},
						415,
					);
			}
			await next();
		});
	}

	/**
	 * Trigger a search for a torrent
	 */
	app.post("/webhook", async (c) => {
		if (!(await authorize(c))) return c.text(API_KEY_REQUIRED, 401);

		const injectJob = getJobs().find((job) => job.name === JobName.INJECT);
		if (injectJob) {
			injectJob.runAheadOfSchedule = true;
			await checkJobs({ isFirstRun: false, useQueue: true });
		}
		await indexTorrentsAndDataDirs();

		const rawData: unknown = c.get("parsedBody");
		let data: z.infer<typeof WEBHOOK_SCHEMA>;
		try {
			data = WEBHOOK_SCHEMA.parse(rawData);
		} catch {
			const message = `A valid infoHash or an accessible path must be provided (infoHash is recommended: see https://www.cross-seed.org/docs/reference/api#post-apiwebhook): ${inspect(rawData)}`;
			logger.error({ label: Label.WEBHOOK, message });
			return c.text(message, 400);
		}

		trackBackground(
			(async () => {
				const criteriaStr = data.infoHash
					? inspect(data).replace(
							data.infoHash,
							sanitizeInfoHash(data.infoHash),
						)
					: inspect(data);

				logger.info({
					label: Label.WEBHOOK,
					message: `Received search request: ${criteriaStr}`,
				});

				const configOverride: Partial<RuntimeConfig> = {
					includeSingleEpisodes: data.includeSingleEpisodes,
					includeNonVideos: data.includeNonVideos,
					excludeRecentSearch: data.ignoreExcludeRecentSearch
						? 1
						: undefined,
					excludeOlder: data.ignoreExcludeOlder
						? Number.MAX_SAFE_INTEGER
						: undefined,
					blockList: data.ignoreBlockList ? [] : undefined,
				};

				try {
					let numFound: number | null = null;
					if (data) {
						numFound = await searchForLocalTorrentByCriteria(data, {
							configOverride,
							ignoreCrossSeeds: data.ignoreCrossSeeds ?? true,
						});
					}

					if (numFound !== null) {
						logger.info({
							label: Label.WEBHOOK,
							message: `Found ${numFound} torrents for ${criteriaStr}`,
						});
					}
				} catch (e) {
					logger.error({
						label: Label.WEBHOOK,
						message: errorMessage(e),
					});
					logger.debug(e);
				}
			})(),
		);
		return c.body(null, 204);
	});

	/**
	 * Reverse lookup for a torrent
	 */
	app.post("/announce", async (c) => {
		if (!(await authorize(c))) return c.text(API_KEY_REQUIRED, 401);

		const { dataDirs, torrentDir, useClientTorrents } = getRuntimeConfig();

		const rawData: unknown = c.get("parsedBody");
		let data: z.infer<typeof ANNOUNCE_SCHEMA>;
		try {
			data = ANNOUNCE_SCHEMA.parse(rawData);
		} catch (zodErr) {
			const zodError = zodErr instanceof z.ZodError ? zodErr : null;
			const errors: string[] = zodError
				? zodError.issues.map((issue) =>
						(issue.path as (string | number)[]).join("."),
					)
				: [];
			const message = `Missing required params (https://www.cross-seed.org/docs/v6-migration#autobrr-update): {${formatAsList(
				errors,
				{ sort: true, type: "unit" },
			)}} in ${inspect(rawData)}\n${inspect(errors)}`;
			logger.error({ label: Label.ANNOUNCE, message });
			return c.text(message, 400);
		}

		logger.verbose({
			label: Label.ANNOUNCE,
			message: `Received announce from ${data.tracker}: ${data.name}`,
		});

		const candidate = data as Candidate;
		const candidateLog = `${chalk.bold.white(candidate.name)} from ${candidate.tracker}`;
		try {
			if (!useClientTorrents && !torrentDir && !dataDirs.length) {
				throw new Error(
					`Announce requires at least one of useClientTorrents, torrentDir, or dataDirs to be set`,
				);
			}
			await indexTorrentsAndDataDirs();
			const result = await checkNewCandidateMatch(
				candidate,
				Label.ANNOUNCE,
			);
			if (!result.decision) {
				return c.body(null, 204);
			}

			const { status, state } = determineResponse(result);
			if (result.actionResult !== InjectionResult.SUCCESS) {
				logger.info({
					label: Label.ANNOUNCE,
					message: `${state} ${candidateLog} (status: ${status})`,
				});
			}
			return new Response(null, { status });
		} catch (e) {
			logger.error({
				label: Label.ANNOUNCE,
				message: errorMessage(e),
			});
			logger.debug(e);
			return c.text(errorMessage(e), 500);
		}
	});

	/**
	 * Run a job ahead of schedule if eligible
	 */
	app.post("/job", async (c) => {
		if (!(await authorize(c))) return c.text(API_KEY_REQUIRED, 401);

		const rawData: unknown = c.get("parsedBody");
		let data: z.infer<typeof JOB_SCHEMA>;
		try {
			data = JOB_SCHEMA.parse(rawData);
		} catch {
			const message = `Job name must be one of ${formatAsList(Object.values(JobName), { sort: true, style: "narrow", type: "unit" })} - received: ${inspect(rawData)}`;
			logger.error({ label: Label.SERVER, message });
			return c.text(message, 400);
		}

		logger.info({
			label: Label.SERVER,
			message: `Received job request: ${inspect(data)}`,
		});

		const job = getJobs().find((j) => j.name === data.name);
		if (!job) {
			const message = `${data.name}: unable to run, disabled in config`;
			logger.error({ label: Label.SCHEDULER, message });
			return c.text(message, 404);
		}

		if (job.isActive) {
			const message = `${job.name}: already running`;
			logger.error({ label: Label.SCHEDULER, message });
			return c.text(message, 409);
		}

		job.runAheadOfSchedule = true;
		job.configOverride = {
			excludeRecentSearch: data.ignoreExcludeRecentSearch ? 1 : undefined,
			excludeOlder: data.ignoreExcludeOlder
				? Number.MAX_SAFE_INTEGER
				: undefined,
		};
		await checkJobs({ isFirstRun: false, useQueue: true });
		const message = `${job.name}: running ahead of schedule`;
		logger.info({ label: Label.SCHEDULER, message });
		return c.text(message, 200);
	});

	/**
	 * current: sends "200 OK"
	 * future: respond with current state and job status details via API
	 * uses: potential usage of this in dashbrr
	 */
	app.get("/status", async (c) => {
		if (!(await authorize(c))) return c.text(API_KEY_REQUIRED, 401);
		return c.text("OK", 200);
	});

	/**
	 * cross-seed health check
	 */
	app.get("/ping", (c) => {
		return c.text("OK", 200);
	});
	return app;
}
