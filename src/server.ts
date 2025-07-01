import chalk from "chalk";
import { existsSync } from "fs";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { z } from "zod";
import fastify, {
	FastifyInstance,
	FastifyRequest,
	FastifyReply,
} from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { checkApiKey } from "./auth.js";
import { registerTRPC } from "./trpc/fastifyAdapter.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	SaveResult,
} from "./constants.js";
import { checkJobs, getJobLastRun, getJobs, JobName } from "./jobs.js";
import { Label, logger } from "./logger.js";
import { getLogWatcher } from "./utils/logWatcher.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { indexTorrentsAndDataDirs } from "./torrent.js";
import { formatAsList, humanReadableDate, sanitizeInfoHash } from "./utils.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import { indexerApiPlugin } from "./routes/indexerApi.js";

const ANNOUNCE_SCHEMA = z
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
	})
	.strict()
	.required()
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

function parseData(data: string) {
	let parsed;
	try {
		parsed = JSON.parse(data);
	} catch (_) {
		parsed = qsParse(data);
	}

	// transformations
	try {
		if ("infoHash" in parsed) {
			parsed.infoHash = parsed.infoHash.toLowerCase();
		}
		if ("size" in parsed && typeof parsed.size === "string") {
			parsed.size = Number(parsed.size);
		}
	} catch (e) {
		throw new Error(`Unable to parse request body: "${data}"`);
	}

	return parsed;
}

/**
 * Checks all http API requests for authorized apiKey
 * uses param `?apikey=` or as header `x-api-key`
 */
async function authorize(
	request: FastifyRequest<{
		Querystring: { apikey?: string };
	}>,
	reply: FastifyReply,
): Promise<boolean> {
	const apiKey =
		(request.headers["x-api-key"] as string) || request.query.apikey || "";
	const isAuthorized = await checkApiKey(apiKey);
	if (!isAuthorized) {
		const ipAddress =
			(request.headers["x-forwarded-for"] as string)
				?.split(",")
				.shift() || request.socket.remoteAddress;
		logger.error({
			label: Label.SERVER,
			message: `Unauthorized API access attempt to ${request.url} from ${ipAddress}`,
		});
		void reply
			.code(401)
			.send(
				"Specify the API key in an X-Api-Key header or an apikey query param.",
			);
	}
	return isAuthorized;
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

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Fastify app
const createServer = async (): Promise<FastifyInstance> => {
	const app = fastify({
		logger: false, // We'll use our own logger
	});

	// Initialize log watcher
	getLogWatcher();

	// Add query string parsing support
	app.addContentTypeParser(
		"application/x-www-form-urlencoded",
		{ parseAs: "string" },
		function (req, body, done) {
			try {
				const parsed = parseData(body as string);
				done(null, parsed);
			} catch (error) {
				done(error as Error, undefined);
			}
		},
	);

	// Add JSON body parsing support
	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		function (req, body, done) {
			try {
				const parsed = parseData(body as string);
				done(null, parsed);
			} catch (error) {
				done(error as Error, undefined);
			}
		},
	);

	// Add raw body parsing support
	app.addContentTypeParser(
		"text/plain",
		{ parseAs: "string" },
		function (req, body, done) {
			try {
				const parsed = parseData(body as string);
				done(null, parsed);
			} catch (error) {
				done(error as Error, undefined);
			}
		},
	);

	// Register cookie plugin
	await app.register(fastifyCookie);

	// Register tRPC router
	await registerTRPC(app);

	// Register Prowlarr integration API routes
	await app.register(indexerApiPlugin);

	// Serve static files from the dist/webui directory
	await app.register(fastifyStatic, {
		root: join(dirname(__dirname), "dist", "webui"),
		prefix: "/",
		decorateReply: true,
	});

	/**
	 * Trigger a search for a torrent
	 */
	app.post<{
		Querystring: { apikey?: string };
	}>("/api/webhook", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const injectJob = getJobs().find((job) => job.name === JobName.INJECT);
		if (injectJob) {
			injectJob.runAheadOfSchedule = true;
			void checkJobs({ isFirstRun: false, useQueue: true });
		}
		await indexTorrentsAndDataDirs();

		let data;
		try {
			data = request.body;
		} catch (e) {
			const message = e.message;
			logger.error({
				label: Label.WEBHOOK,
				message,
			});
			return reply.code(400).send(message);
		}

		try {
			data = WEBHOOK_SCHEMA.parse(data);
		} catch {
			const message = `A valid infoHash or an accessible path must be provided (infoHash is recommended: see https://www.cross-seed.org/docs/reference/api#post-apiwebhook): ${inspect(data)}`;
			logger.error({ label: Label.WEBHOOK, message });
			return reply.code(400).send(message);
		}

		void reply.code(204).send();

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
			excludeRecentSearch: data.ignoreExcludeRecentSearch ? 1 : undefined,
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
				message: e.message,
			});
			logger.debug(e);
		}
	});

	/**
	 * Reverse lookup for a torrent
	 */
	app.post<{
		Querystring: { apikey?: string };
	}>("/api/announce", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const { dataDirs, torrentDir, useClientTorrents } = getRuntimeConfig();
		await indexTorrentsAndDataDirs();

		let data;
		try {
			data = request.body;
		} catch (e) {
			const message = e.message;
			logger.error({
				label: Label.ANNOUNCE,
				message,
			});
			return reply.code(400).send(message);
		}

		try {
			data = ANNOUNCE_SCHEMA.parse(data);
		} catch ({ errors }) {
			const message = `Missing required params (https://www.cross-seed.org/docs/v6-migration#autobrr-update): {${formatAsList(
				errors.map(({ path }) => path.join(".")),
				{ sort: true, type: "unit" },
			)}} in ${inspect(data)}\n${inspect(errors)}`;
			logger.error({ label: Label.ANNOUNCE, message });
			return reply.code(400).send(message);
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
			const result = await checkNewCandidateMatch(
				candidate,
				Label.ANNOUNCE,
			);
			if (!result.decision) {
				return await reply.code(204).send();
			}

			const { status, state } = determineResponse(result);
			if (result.actionResult !== InjectionResult.SUCCESS) {
				logger.info({
					label: Label.ANNOUNCE,
					message: `${state} ${candidateLog} (status: ${status})`,
				});
			}
			return await reply.code(status).send();
		} catch (e) {
			logger.error({
				label: Label.ANNOUNCE,
				message: e.message,
			});
			logger.debug(e);
			return reply.code(500).send(e.message);
		}
	});

	/**
	 * Run a job ahead of schedule if elligible
	 */
	app.post<{
		Querystring: { apikey?: string };
	}>("/api/job", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		let data;
		try {
			data = request.body;
		} catch (e) {
			const message = e.message;
			logger.error({
				label: Label.SERVER,
				message,
			});
			return reply.code(400).send(message);
		}

		try {
			data = JOB_SCHEMA.parse(data);
		} catch {
			const message = `Job name must be one of ${formatAsList(Object.values(JobName), { sort: true, style: "narrow", type: "unit" })} - received: ${inspect(data)}`;
			logger.error({ label: Label.SERVER, message });
			return reply.code(400).send(message);
		}

		logger.info({
			label: Label.SERVER,
			message: `Received job request: ${inspect(data)}`,
		});

		const job = getJobs().find((j) => j.name === data.name);
		if (!job) {
			const message = `${data.name}: unable to run, disabled in config`;
			logger.error({ label: Label.SCHEDULER, message });
			return reply.code(404).send(message);
		}

		if (job.isActive) {
			const message = `${job.name}: already running`;
			logger.error({ label: Label.SCHEDULER, message });
			return reply.code(409).send(message);
		}

		const lastRun = (await getJobLastRun(job.name)) ?? 0;
		if (Date.now() < lastRun) {
			const message = `${job.name}: not elligible to run ahead of schedule, next scheduled run is at ${humanReadableDate(lastRun + job.cadence)} (triggering an early run is allowed after ${humanReadableDate(lastRun)})`;
			logger.error({ label: Label.SCHEDULER, message });
			return reply.code(409).send(message);
		}

		job.runAheadOfSchedule = true;
		if (job.name === JobName.SEARCH || job.name === JobName.RSS) {
			job.delayNextRun = true;
		}
		job.configOverride = {
			excludeRecentSearch: data.ignoreExcludeRecentSearch ? 1 : undefined,
			excludeOlder: data.ignoreExcludeOlder
				? Number.MAX_SAFE_INTEGER
				: undefined,
		};
		void checkJobs({ isFirstRun: false, useQueue: true });
		const message = `${job.name}: running ahead of schedule`;
		logger.info({ label: Label.SCHEDULER, message });
		return reply.code(200).send(message);
	});

	/**
	 * current: sends "200 OK"
	 * future: respond with current state and job status details via API
	 * uses: potential usage of this in dashbrr
	 */
	app.get<{
		Querystring: { apikey?: string };
	}>("/api/status", async (request, reply) => {
		if (!(await authorize(request, reply))) return;
		return reply.code(200).send("OK");
	});

	/**
	 * cross-seed health check
	 */
	app.get("/api/ping", async (request, reply) => {
		return reply.code(200).send("OK");
	});

	// Handle 404s
	app.setNotFoundHandler((request, reply) => {
		// If the request path starts with /api, it's an API request that wasn't found
		if (request.url.startsWith("/api")) {
			const message = `Unknown endpoint: ${request.url}`;
			logger.error({ label: Label.SERVER, message });
			void reply.code(404).send(message);
			return;
		}

		// For all other requests, serve the SPA index.html to support client-side routing
		void reply.sendFile("index.html");
	});

	// Handle method not allowed
	app.setErrorHandler((error, request, reply) => {
		if (error.statusCode === 405) {
			const message = `Method ${request.method} not allowed for ${request.url}`;
			logger.error({ label: Label.SERVER, message });
			return reply.code(405).send(message);
		}
		void reply.send(error);
	});

	return app;
};

/**
 * Listens (daemon) on configured port for http API calls
 */
export async function serve(port?: number, host?: string): Promise<void> {
	if (!port) return;
	const server = await createServer();

	return new Promise((resolve) => {
		server.listen({ port, host }, (err) => {
			if (err) {
				logger.error({
					label: Label.SERVER,
					message: `Failed to start server: ${err.message}`,
				});
				process.exit(1);
			}
			logger.info({
				label: Label.SERVER,
				message: `Server is running on port ${port}, ^C to stop.`,
			});
		});

		function stop() {
			server.close(() => {
				logger.info({
					label: Label.SERVER,
					message: "Server stopped",
				});
				resolve();
			});
		}

		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}
