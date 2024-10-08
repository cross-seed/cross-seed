import chalk from "chalk";
import { existsSync } from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import { pick } from "lodash-es";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { checkApiKey } from "./auth.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	SaveResult,
} from "./constants.js";
import { getEnabledIndexers } from "./indexers.js";
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { indexNewTorrents, TorrentLocator } from "./torrent.js";
import { sanitizeInfoHash } from "./utils.js";

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
	const { torznab } = getRuntimeConfig();
	if (torznab.length === 0 || (await getEnabledIndexers()).length === 0) {
		const searchFailureReason = `No ${torznab.length === 0 ? "configured" : "available"} Torznab indexers`;
		logger.warn({
			label: Label.WEBHOOK,
			message: `Received request but did not search: ${searchFailureReason}`,
		});
		logger.verbose({
			label: Label.WEBHOOK,
			message: `Received search request: ${inspect(data)}`,
		});
		res.writeHead(503);
		res.end(searchFailureReason);
		return;
	}

	const criteria: TorrentLocator = pick(data, ["infoHash", "path"]);

	if (
		!(
			(criteria.infoHash && criteria.infoHash.length === 40) ||
			(criteria.path &&
				criteria.path.length > 0 &&
				existsSync(criteria.path))
		)
	) {
		logger.info({
			label: Label.WEBHOOK,
			message: `Received search request: ${inspect(criteria)}`,
		});

		const message =
			"A valid infoHash or accessible path must be provided (infoHash is preferred).";
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

	if (
		!(
			"guid" in data &&
			"name" in data &&
			"link" in data &&
			"tracker" in data
		)
	) {
		const message = "Missing params: {guid, name, link, tracker} required";
		logger.error({
			label: Label.ANNOUNCE,
			message,
		});
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

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	if (!(await authorize(req, res))) return;

	if (req.method !== "POST") {
		res.writeHead(405);
		res.end("Methods allowed: POST");
		return;
	}

	switch (req.url!.split("?")[0]) {
		case "/api/webhook": {
			logger.verbose({
				label: Label.SERVER,
				message: "POST /api/webhook",
			});
			return search(req, res);
		}

		case "/api/announce": {
			logger.verbose({
				label: Label.SERVER,
				message: "POST /api/announce",
			});
			return announce(req, res);
		}
		default: {
			res.writeHead(404);
			res.end("Endpoint not found");
			return;
		}
	}
}

export function serve(port: number, host: string | undefined): void {
	if (port) {
		const server = http.createServer(handleRequest);
		server.listen(port, host);
		logger.info({
			label: Label.SERVER,
			message: `Server is running on port ${port}, ^C to stop.`,
		});
	}
}
