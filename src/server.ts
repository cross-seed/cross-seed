import fs from "fs";
import http from "http";
import qs from "querystring";
import { validateJackettApi } from "./jackett";
import { Label, logger } from "./logger";
import { searchForSingleTorrentByName } from "./pipeline";
import { getRuntimeConfig } from "./runtimeConfig";

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
	try {
		return JSON.parse(data);
	} catch (_) {
		const parsed = qs.parse(data);
		if ("name" in parsed) return parsed;
		throw new Error(`Unable to parse request body: "${data}"`);
	}
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
	const { name } = parseData(dataStr);
	res.writeHead(204);
	res.end();
	logger.info({ label: Label.SERVER, message: `Received name ${name}` });
	try {
		const numFound = await searchForSingleTorrentByName(name);
		if (numFound === null) {
			logger.info({
				label: Label.SERVER,
				message: `Did not search for ${name}`,
			});
		} else {
			logger.info({
				label: Label.SERVER,
				message: `Found ${numFound} torrents for ${name}`,
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
