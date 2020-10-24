const fs = require("fs");
const http = require("http");

const { searchForSingleTorrentByName } = require("./index");
const { validateJackettApi } = require("./jackett");
const logger = require("./logger");

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

const handleRequest = (config) => async (req, res) => {
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
	const name = await getData(req);
	res.writeHead(204);
	res.end();
	logger.log("Received name", name);
	try {
		const numFound = await searchForSingleTorrentByName(name, config);
		logger.log(`Found ${numFound} torrents for ${name}`);
	} catch (e) {
		logger.error(e);
	}
};

async function serve(config) {
	const { outputDir } = config;
	try {
		await validateJackettApi(config);
	} catch (e) {
		return;
	}

	fs.mkdirSync(outputDir, { recursive: true });
	const server = http.createServer(handleRequest(config));
	server.listen(2468);
	logger.log("Server is running on port 2468, ^C to stop.");
}

module.exports = { serve };
