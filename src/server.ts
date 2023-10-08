import http, { IncomingMessage, ServerResponse } from "http";
import url from "url";
import { pick } from "lodash-es";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { indexNewTorrents, TorrentLocator } from "./torrent.js";

let secretApiKey = "";

function getData(req): Promise<string> {
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

function parseData(data) {
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

// isValidAPIKey check if api key is valid or not
function isValidAPIKey(req: IncomingMessage): boolean {
	// if no api key is set then always return true
	if (secretApiKey === "") {
		return true
	}

	const parsedUrl = url.parse(req.url, true);

	// get apikey from query /params?apikey=supersecretapikey
	const apiKeyQueryParam = parsedUrl.query.apikey;

	// get apikey from header
	const apiKeyHeader = req.headers['x-api-key'];

	if (apiKeyQueryParam === secretApiKey || apiKeyHeader === secretApiKey) {
		return true; // API key is valid.
	}

	return false; // API key is invalid.
}

async function search(
	req: IncomingMessage,
	res: ServerResponse
): Promise<void> {
	if (!isValidAPIKey(req)) {
		const message = "Unauthorized";
		logger.error({ label: Label.SERVER, message });
		res.writeHead(401);
		res.end();
		return;
	}

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
	if (!isValidAPIKey(req)) {
		const message = "Unauthorized";
		logger.error({ label: Label.SERVER, message });
		res.writeHead(401);
		res.end();
		return;
	}

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
		if (!result) {
			res.writeHead(204);
			res.end();
			return;
		}
		logger.info({
			label: Label.SERVER,
			message: `Added announce from ${candidate.tracker}: ${candidate.name}`,
		});
		res.setHeader("Content-Type", "application/json");
		res.writeHead(200);
		res.end(JSON.stringify(result));
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

export function serve(port: number, host: string | undefined, apiKey: string | undefined): void {
	if (apiKey) {
		secretApiKey = apiKey
	}

	if (port) {
		const server = http.createServer(handleRequest);
		server.listen(port, host);
		logger.info({
			label: Label.SERVER,
			message: `Server is running on port ${port}, ^C to stop.`,
		});
	}
}
