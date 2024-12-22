import chalk from "chalk";
import { existsSync } from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import { pick } from "lodash-es";
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
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { indexNewTorrents, TorrentLocator } from "./torrent.js";
import { formatAsList, sanitizeInfoHash } from "./utils.js";

const ANNOUNCE_SCHEMA = z
	.object({
		name: z.string().refine((name) => name.trim().length > 0),
		guid: z.string().url(),
		link: z.string().url(),
		tracker: z.string().refine((tracker) => tracker.trim().length > 0),
	})
	.strict()
	.required()
	.refine((data) => data.guid === data.link);

const WEBHOOK_SCHEMA = z
	.object({
		infoHash: z.string().length(40),
		path: z.string().refine((path) => !path || existsSync(path)),
	})
	.strict()
	.partial()
	.refine((data) => Object.keys(data).length === 1);

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

async function authorize(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	/**
	 * checks all http API requests for authorized apiKey
	 * uses param `?apikey=` or as header `x-api-key`
	 */
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

async function search(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	/**
	 * processes matching a local searchee provided via /api/webhook
	 * on all currently configured torznab indexers
	 */
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
	let criteria: TorrentLocator = pick(data, ["infoHash", "path"]);

	try {
		criteria = WEBHOOK_SCHEMA.parse(criteria) as TorrentLocator;
	} catch {
		const message = `A valid infoHash or an accessible path must be provided (infoHash is recommended: see https://www.cross-seed.org/docs/reference/api): ${inspect(criteria)}`;
		logger.error({ label: Label.WEBHOOK, message });
		res.writeHead(400);
		res.end(message);
		return;
	}

	const criteriaStr = criteria.infoHash
		? inspect(criteria).replace(
				criteria.infoHash,
				sanitizeInfoHash(criteria.infoHash),
			)
		: inspect(criteria);

	res.writeHead(204);
	res.end();

	logger.info({
		label: Label.WEBHOOK,
		message: `Received search request: ${criteriaStr}`,
	});

	await indexNewTorrents();

	try {
		let numFound: number | null = null;
		if (criteria) {
			numFound = await searchForLocalTorrentByCriteria(criteria);
		}

		if (numFound === null) {
			logger.info({
				label: Label.WEBHOOK,
				message: `Did not search for ${criteriaStr} (check verbose logs for preFilter reason)`,
			});
		} else {
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

async function announce(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	/**
	 * processes matching a new candidate provided via /api/announce
	 * to local torrent based on provided criteria
	 */
	const { torrentDir } = getRuntimeConfig();
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
		if (!torrentDir) {
			throw new Error("Announce requires torrentDir");
		}
		await indexNewTorrents();
		const result = await checkNewCandidateMatch(candidate, Label.ANNOUNCE);
		if (!result.decision) {
			res.writeHead(204);
			res.end();
			return;
		}

		const { status, state } = determineResponse(result);
		logger.info({
			label: Label.ANNOUNCE,
			message: `${state} ${candidateLog} (status: ${status})`,
		});
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

async function status(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	/**
	 current: sends "200 OK"
	 future: respond with current state and job status details via API
	 uses: potential usage of this in dashbrr
	 */
	res.writeHead(200);
	res.end("OK");
}

async function ping(req: IncomingMessage, res: ServerResponse): Promise<void> {
	/**
	 * sends "200 OK" for external health check via API
	 */
	res.writeHead(200);
	res.end("OK");
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	/**
	 * request handling upon receiving an http API call
	 */
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

export function serve(port: number, host: string | undefined): void {
	/**
	 * listens (daemon) on configured port for http API calls
	 */
	if (port) {
		const server = http.createServer(handleRequest);
		server.listen(port, host);
		logger.info({
			label: Label.SERVER,
			message: `Server is running on port ${port}, ^C to stop.`,
		});
	}
}
