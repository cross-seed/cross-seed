import http, { IncomingMessage, ServerResponse } from "http";
import { pick } from "lodash-es";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { checkApiKey } from "./auth.js";
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { InjectionResult, SaveResult } from "./constants.js";
import { indexNewTorrents, TorrentLocator } from "./torrent.js";

function getData(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks = [];
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
	res: ServerResponse
): Promise<boolean> {
	const url = new URL(req.url, `http://${req.headers.host}`);
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
			"Specify the API key in an X-Api-Key header or an apikey query param."
		);
	}
	return isAuthorized;
}

async function search(
	req: IncomingMessage,
	res: ServerResponse
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
	const criteria: TorrentLocator = pick(data, ["infoHash", "name", "path"]);

	if (!("infoHash" in criteria || "name" in criteria || "path" in criteria)) {
		const message = "A name, info hash, or path must be provided";
		logger.error({ label: Label.SERVER, message });
		res.writeHead(400);
		res.end(message);
		return;
	}

	const criteriaStr = inspect(criteria);

	res.writeHead(204);
	res.end();

	logger.info({
		label: Label.SERVER,
		message: `Received search request: ${criteriaStr}`,
	});

	await indexNewTorrents();

	try {
		let numFound = null;
		if (criteria) {
			numFound = await searchForLocalTorrentByCriteria(criteria);
		}

		if (numFound === null) {
			logger.info({
				label: Label.SERVER,
				message: `Did not search for ${criteriaStr}`,
			});
		} else {
			logger.info({
				label: Label.SERVER,
				message: `Found ${numFound} torrents for ${criteriaStr}`,
			});
		}
	} catch (e) {
		logger.error(e);
		logger.debug(e);
	}
}

async function announce(
	req: IncomingMessage,
	res: ServerResponse
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
			label: Label.SERVER,
			message,
		});
		res.writeHead(400);
		res.end(message);
		return;
	}

	logger.verbose({
		label: Label.SERVER,
		message: `Received announce: ${data.name}`,
	});

	const candidate = data as Candidate;
	try {
		await indexNewTorrents();
		const result = await checkNewCandidateMatch(candidate);
		const isOk =
			result === InjectionResult.SUCCESS || result === SaveResult.SAVED;
		if (!isOk) {
			if (result === InjectionResult.TORRENT_NOT_COMPLETE) {
				res.writeHead(202);
			} else {
				res.writeHead(204);
			}
		} else {
			logger.info({
				label: Label.SERVER,
				message: `Added announce from ${candidate.tracker}: ${candidate.name}`,
			});
			res.writeHead(200);
		}
		res.end();
	} catch (e) {
		logger.error(e);
		res.writeHead(500);
		res.end(e.message);
	}
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse
): Promise<void> {
	if (!(await authorize(req, res))) return;

	if (req.method !== "POST") {
		res.writeHead(405);
		res.end("Methods allowed: POST");
		return;
	}

	switch (req.url) {
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
