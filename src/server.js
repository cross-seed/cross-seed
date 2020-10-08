const fs = require("fs");
const http = require("http");
const chalk = require("chalk");

const { searchForSingleTorrentByName } = require("./index");
const { validateJackettApi } = require("./jackett");

const handleRequest = (config) => (req, res) => {
	if (req.method !== "POST") {
		res.writeHead(405);
		res.end();
		return;
	}

	let chunks = [];
	req.on("data", (chunk) => chunks.push(chunk.toString()));
	req.on("end", async () => {
		const name = chunks.join("");
		console.log("Received name", name);
		try {
			await searchForSingleTorrentByName(name, config);
		} catch (e) {
			res.writeHead(500);
			res.end();
			console.error(e.stack);
			return;
		}

		res.writeHead(204);
		res.end();
	});
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
	console.log("Server is running on port 2468, ^C to stop.");
}

module.exports = { serve };
