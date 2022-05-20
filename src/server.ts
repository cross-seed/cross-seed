import http, { IncomingMessage, ServerResponse } from "http";
import { pick } from "lodash-es";
import { parse as qsParse } from "querystring";
import { inspect } from "util";
import { Label, logger } from "./logger.js";
import {
	Candidate,
	checkNewCandidateMatch,
	searchForLocalTorrentByCriteria,
} from "./pipeline.js";
import { NonceOptions } from "./runtimeConfig.js";
import { TorrentLocator } from "./torrent.js";

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
	const criteria: TorrentLocator = pick(data, ["infoHash", "name"]);
	const nonceOptions: NonceOptions = pick(data, ["outputDir"]);

	if (!("infoHash" in criteria || "name" in criteria)) {
		const message = "A name or info hash must be provided";
		logger.error({ label: Label.SERVER, message });
		res.writeHead(400);
		res.end(message);
	}

	const criteriaStr = inspect(criteria);

	res.writeHead(204);
	res.end();

	logger.info({
		label: Label.SERVER,
		message: `Received search request: ${criteriaStr}`,
	});

	try {
		let numFound = null;
		if (criteria) {
			numFound = await searchForLocalTorrentByCriteria(
				criteria,
				nonceOptions
			);
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
		const result = await checkNewCandidateMatch(candidate);
		if (result) {
			logger.info({
				label: Label.SERVER,
				message: `Added announce from ${candidate.tracker}: ${candidate.name}`,
			});
		}
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

export async function serve(port: number): Promise<void> {
	const server = http.createServer(handleRequest);
	server.listen(port);
	logger.info({
		label: Label.SERVER,
		message: `Server is running on port ${port}, ^C to stop.`,
	});
}
