import fs from "fs";
import http from "http";
import qs from "querystring";
import { inspect } from "util";
import { Label, logger } from "./logger";
import { searchForLocalTorrentByCriteria } from "./pipeline";
import { getRuntimeConfig } from "./runtimeConfig";
import { TorrentLocator } from "./torrent";

function getData(req) {
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
		parsed = qs.parse(data);
	}

	if ("infoHash" in parsed) {
		parsed.infoHash = parsed.infoHash.toLowerCase();
	}
	if ("name" in parsed || "infoHash" in parsed) {
		return parsed;
	}

	throw new Error(`Unable to parse request body: "${data}"`);
}

async function handleRequest(req, res) {
	if (req.method !== "POST") {
		res.writeHead(405);
		res.end();
		return;
	}
	if (req.url !== "/api/webhook") {
		res.writeHead(404);
		res.end();
		return;
	}
	const dataStr = await getData(req);
	const criteria: TorrentLocator = parseData(dataStr);

	if (!criteria) {
		logger.error({
			label: Label.SERVER,
			message: "A name or info hash must be provided",
		});
		res.writeHead(400);
		res.end();
	}

	const criteriaStr = inspect({ ...criteria });

	res.writeHead(204);
	res.end();

	logger.info({ label: Label.SERVER, message: `Received  ${criteriaStr}` });

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
	}
}

export async function serve(): Promise<void> {
	const { outputDir } = getRuntimeConfig();
	fs.mkdirSync(outputDir, { recursive: true });
	const server = http.createServer(handleRequest);
	server.listen(2468);
	logger.info({
		label: Label.SERVER,
		message: "Server is running on port 2468, ^C to stop.",
	});
}
