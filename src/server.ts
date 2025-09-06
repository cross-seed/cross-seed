import chalk from "chalk";
import { existsSync } from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { z } from "zod";
import { checkApiKey } from "./auth.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	SaveResult,
} from "./constants.js";
import { checkJobs, getJobLastRun, getJobs, JobName } from "./jobs.js";
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { indexTorrentsAndDataDirs } from "./torrent.js";
import { formatAsList, humanReadableDate, sanitizeInfoHash } from "./utils.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";

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
		cookie: z
			.string()
			.nullish()
			.transform((cookie) => cookie?.trim() || undefined),
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

function getData(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: string[] = [];
		req.on("data", (chunk) => {
			chunks.push(chunk.toString());
		});
		req.on("end", async () => {
			resolve(chunks.join(""));
		});
	});
}

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
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url!, `http://${req.headers.host}`);
	const apiKey =
		(req.headers["x-api-key"] as string) ?? url.searchParams.get("apikey");
	const isAuthorized = await checkApiKey(apiKey);
	if (!isAuthorized) {
		const ipAddress =
			(req.headers["x-forwarded-for"] as string)?.split(",").shift() ||
			req.socket?.remoteAddress;
		logger.error({
			label: Label.SERVER,
			message: `Unauthorized API access attempt to ${url.pathname} from ${ipAddress}`,
		});
		res.writeHead(401, "Unauthorized");
		res.end(
			"Specify the API key in an X-Api-Key header or an apikey query param.",
		);
	}
	return isAuthorized;
}

/**
 * Trigger a search for a torrent
 */
async function search(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const dataStr = await getData(req);
	let data;
	try {
		data = parseData(dataStr);
	} catch (e) {
		logger.error({
			label: Label.WEBHOOK,
			message: e.message,
		});
		res.writeHead(400);
		res.end(e.message);
		return;
	}

	try {
		data = WEBHOOK_SCHEMA.parse(data);
	} catch {
		const message = `A valid infoHash or an accessible path must be provided (infoHash is recommended: see https://www.cross-seed.org/docs/reference/api#post-apiwebhook): ${inspect(data)}`;
		logger.error({ label: Label.WEBHOOK, message });
		res.writeHead(400);
		res.end(message);
		return;
	}
	res.writeHead(204);
	res.end();

	const criteriaStr = data.infoHash
		? inspect(data).replace(data.infoHash, sanitizeInfoHash(data.infoHash))
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
		const injectJob = getJobs().find((job) => job.name === JobName.INJECT);
		if (injectJob) {
			injectJob.runAheadOfSchedule = true;
			void checkJobs({ isFirstRun: false, useQueue: true });
		}
		await indexTorrentsAndDataDirs();
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

/**
 * Reverse lookup for a torrent
 */
async function announce(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const { dataDirs, torrentDir, useClientTorrents } = getRuntimeConfig();
	const dataStr = await getData(req);
	let data;
	try {
		data = parseData(dataStr);
	} catch (e) {
		logger.error({
			label: Label.ANNOUNCE,
			message: e.message,
		});
		res.writeHead(400);
		res.end(e.message);
		return;
	}

	try {
		data = ANNOUNCE_SCHEMA.parse(data);
	} catch ({ errors }) {
		const message = `Missing required params (https://www.cross-seed.org/docs/v6-migration#autobrr-update): {${formatAsList(
			errors.map(({ path }) => path.join(".")),
			{ sort: true, type: "unit" },
		)}} in ${inspect(data)}\n${inspect(errors)}`;
		logger.error({ label: Label.ANNOUNCE, message });
		res.writeHead(400);
		res.end(message);
		return;
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
		const result = await checkNewCandidateMatch(candidate, Label.ANNOUNCE);
		if (!result.decision) {
			res.writeHead(204);
			res.end();
			return;
		}

		const { status, state } = determineResponse(result);
		if (result.actionResult !== InjectionResult.SUCCESS) {
			logger.info({
				label: Label.ANNOUNCE,
				message: `${state} ${candidateLog} (status: ${status})`,
			});
		}
		res.writeHead(status);
		res.end();
	} catch (e) {
		logger.error({
			label: Label.ANNOUNCE,
			message: e.message,
		});
		logger.debug(e);
		res.writeHead(500);
		res.end(e.message);
	}
}

/**
 * Run a job ahead of schedule if eligible
 */
async function runJob(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const dataStr = await getData(req);
	let data;
	try {
		data = parseData(dataStr);
	} catch (e) {
		logger.error({
			label: Label.SERVER,
			message: e.message,
		});
		res.writeHead(400);
		res.end(e.message);
		return;
	}

	try {
		data = JOB_SCHEMA.parse(data);
	} catch {
		const message = `Job name must be one of ${formatAsList(Object.values(JobName), { sort: true, style: "narrow", type: "unit" })} - received: ${inspect(data)}`;
		logger.error({ label: Label.SERVER, message });
		res.writeHead(400);
		res.end(message);
		return;
	}

	logger.info({
		label: Label.SERVER,
		message: `Received job request: ${inspect(data)}`,
	});

	const job = getJobs().find((j) => j.name === data.name);
	if (!job) {
		const message = `${data.name}: unable to run, disabled in config`;
		logger.error({ label: Label.SCHEDULER, message });
		res.writeHead(404);
		res.end(message);
		return;
	}

	if (job.isActive) {
		const message = `${job.name}: already running`;
		logger.error({ label: Label.SCHEDULER, message });
		res.writeHead(409);
		res.end(message);
		return;
	}

	const lastRun = (await getJobLastRun(job.name)) ?? 0;
	if (Date.now() < lastRun) {
		const message = `${job.name}: not eligible to run ahead of schedule, next scheduled run is at ${humanReadableDate(lastRun + job.cadence)} (triggering an early run is allowed after ${humanReadableDate(lastRun)})`;
		logger.error({ label: Label.SCHEDULER, message });
		res.writeHead(409);
		res.end(message);
		return;
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
	res.writeHead(200);
	res.end(`${job.name}: running ahead of schedule`);
}

/**
 * current: sends "200 OK"
 * future: respond with current state and job status details via API
 * uses: potential usage of this in dashbrr
 */
async function status(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	res.writeHead(200);
	res.end("OK");
}

/**
 * cross-seed health check
 */
async function ping(req: IncomingMessage, res: ServerResponse): Promise<void> {
	res.writeHead(200);
	res.end("OK");
}

/**
 * Request router
 */
async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const checkMethod = (method: string, endpoint: string) => {
		if (req.method === method) return true;
		res.writeHead(405);
		res.end(`Method ${req.method} not allowed for ${endpoint}`);
		return false;
	};

	const endpoint = req.url!.split("?")[0];
	switch (endpoint) {
		case "/api/announce":
			if (!checkMethod("POST", endpoint)) return;
			if (!(await authorize(req, res))) return;
			return announce(req, res);
		case "/api/webhook":
			if (!checkMethod("POST", endpoint)) return;
			if (!(await authorize(req, res))) return;
			return search(req, res);
		case "/api/job":
			if (!checkMethod("POST", endpoint)) return;
			if (!(await authorize(req, res))) return;
			return runJob(req, res);
		case "/api/ping":
			if (!checkMethod("GET", endpoint)) return;
			return ping(req, res);
		case "/api/status":
			if (!checkMethod("GET", endpoint)) return;
			if (!(await authorize(req, res))) return;
			return status(req, res);
		default: {
			const message = `Unknown endpoint: ${endpoint}`;
			logger.error({ label: Label.SERVER, message });
			res.writeHead(404);
			res.end(message);
			return;
		}
	}
}

/**
 * Listens (daemon) on configured port for http API calls
 */
export async function serve(port?: number, host?: string): Promise<void> {
	if (!port) return;
	return new Promise((resolve) => {
		const server = http.createServer(handleRequest);
		server.listen(port, host);
		function stop() {
			server.close(() => {
				logger.info({
					label: Label.SERVER,
					message: "Server stopped",
				});
			});
			resolve();
		}
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
		logger.info({
			label: Label.SERVER,
			message: `Server is running on port ${port}, ^C to stop.`,
		});
	});
}
