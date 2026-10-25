import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import bencode from "bencode";

export const release = "Imaginary.Garden.S01E01.1080p.WEB-DL-TEST";
export const filename = `${release}.mkv`;
export const content = Buffer.alloc(256 * 1024, 42);
const info = {
	name: filename,
	length: content.length,
	"piece length": content.length,
	pieces: createHash("sha1").update(content).digest(),
};
// A tracker-specific source key yields distinct torrents over the same bytes.
export const sourceHash = createHash("sha1")
	.update(bencode.encode({ ...info, source: "SIMULATED-SOURCE", private: 1 }))
	.digest("hex");
export const candidateHash = createHash("sha1")
	.update(bencode.encode(info))
	.digest("hex");

async function listen(handler) {
	const errors = [];
	const server = createServer((req, res) => {
		Promise.resolve(handler(req, res)).catch((error) => {
			errors.push(error);
			res.writeHead(500).end(String(error));
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		errors,
		async close() {
			server.closeAllConnections();
			await new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

// Deliberately narrow protocol simulators: unsupported operations fail loudly.
// All application requests still pass through the production network adapters.
export async function startIndexer() {
	const requests = [];
	let url;
	const server = await listen(async (req, res) => {
		const request = new URL(req.url, url);
		requests.push(request.pathname + request.search);
		if (request.pathname === "/candidate.torrent") {
			res.setHeader("content-type", "application/x-bittorrent");
			res.end(bencode.encode({ announce: `${url}/announce`, info }));
			return;
		}
		assert.equal(request.pathname, "/api");
		assert.equal(
			request.searchParams.get("apikey"),
			"simulated-indexer-key",
		);
		res.setHeader("content-type", "application/xml");
		if (request.searchParams.get("t") === "caps") {
			res.end(
				`<caps><server title="Simulated Torznab"/><limits max="100" default="100"/><searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep"/></searching><categories><category id="5000" name="TV"/></categories></caps>`,
			);
			return;
		}
		assert.ok(
			["search", "tvsearch"].includes(request.searchParams.get("t")),
		);
		res.end(
			`<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Simulated Torznab</title><item><title>${release}</title><guid>${url}/candidate.torrent</guid><link>${url}/candidate.torrent</link><pubDate>${new Date().toUTCString()}</pubDate><size>${content.length}</size><category>5000</category><enclosure url="${url}/candidate.torrent" length="${content.length}" type="application/x-bittorrent"/><torznab:attr name="seeders" value="5"/></item></channel></rss>`,
		);
	});
	url = server.url;
	return { ...server, requests };
}

function torrent(hash, savePath, options = {}) {
	return {
		hash,
		infohash_v1: hash,
		name: filename,
		save_path: savePath,
		content_path: join(savePath, filename),
		total_size: content.length,
		size: content.length,
		amount_left: 0,
		progress: 1,
		state: "stalledUP",
		completed: content.length,
		completion_on: 1700000000,
		added_on: 1700000000,
		auto_tmm: false,
		category: "source",
		tags: "",
		tracker: "http://source.invalid/announce",
		...options,
	};
}

export async function startQbittorrent(dataDir) {
	const torrents = new Map([[sourceHash, torrent(sourceHash, dataDir)]]);
	const requests = [];
	const additions = [];
	let disconnectInfoRequests = 0;
	let disconnections = 0;
	let successfulInfoRequests = 0;
	const server = await listen(async (req, res) => {
		const operation = new URL(req.url, "http://localhost").pathname;
		assert.equal(req.method, "POST");
		requests.push(operation);
		if (operation === "/api/v2/auth/login") {
			const params = new URLSearchParams(await new Response(req).text());
			assert.equal(params.get("username"), "test");
			assert.equal(params.get("password"), "test-password");
			res.setHeader(
				"set-cookie",
				"SID=simulated-session; HttpOnly; Path=/",
			);
			res.end("Ok.");
			return;
		}
		if (!/SID=simulated-session/.test(req.headers.cookie ?? "")) {
			res.writeHead(403).end("Forbidden");
			return;
		}
		if (
			operation === "/api/v2/torrents/info" &&
			disconnectInfoRequests > 0
		) {
			disconnectInfoRequests--;
			disconnections++;
			req.socket.destroy();
			return;
		}
		if (operation === "/api/v2/torrents/add") {
			const form = await new Request("http://localhost", {
				method: "POST",
				headers: req.headers,
				body: req,
				duplex: "half",
			}).formData();
			const bytes = Buffer.from(await form.get("torrents").arrayBuffer());
			const decoded = bencode.decode(bytes);
			const hash = createHash("sha1")
				.update(bencode.encode(decoded.info))
				.digest("hex");
			assert.equal(hash, candidateHash);
			assert.equal(form.get("contentLayout"), "Original");
			assert.equal(form.get("autoTMM"), "false");
			const addition = Object.fromEntries(
				[...form].filter(([key]) => key !== "torrents"),
			);
			additions.push(addition);
			torrents.set(
				hash,
				torrent(hash, form.get("savepath"), {
					category: form.get("category") ?? "",
					tags: form.get("tags") ?? "",
				}),
			);
			res.end("Ok.");
			return;
		}
		const params = new URLSearchParams(await new Response(req).text());
		const hash = params.get("hash") ?? params.get("hashes");
		res.setHeader("content-type", "application/json");
		switch (operation) {
			case "/api/v2/app/version":
				res.end("5.1.0");
				break;
			case "/api/v2/app/preferences":
				res.end(JSON.stringify({ bypass_local_auth: false }));
				break;
			case "/api/v2/torrents/info":
				successfulInfoRequests++;
				res.end(
					JSON.stringify(
						[...torrents.values()].filter(
							(t) => !hash || t.hash === hash,
						),
					),
				);
				break;
			case "/api/v2/torrents/files":
				assert.ok(torrents.has(hash));
				res.end(
					JSON.stringify([
						{
							name: filename,
							size: content.length,
							progress: 1,
							priority: 1,
						},
					]),
				);
				break;
			case "/api/v2/torrents/trackers":
				assert.ok(torrents.has(hash));
				res.end(
					JSON.stringify([
						{
							url: "http://source.invalid/announce",
							tier: 0,
							status: 2,
						},
					]),
				);
				break;
			case "/api/v2/torrents/createTags":
				assert.equal(params.get("tags"), "cross-seed");
				res.end("Ok.");
				break;
			default:
				throw new Error(
					`Unsupported qBittorrent operation: ${operation}`,
				);
		}
	});
	return {
		...server,
		torrents,
		requests,
		additions,
		get disconnections() {
			return disconnections;
		},
		get successfulInfoRequests() {
			return successfulInfoRequests;
		},
		disconnectNextInfoRequest() {
			disconnectInfoRequests++;
		},
	};
}
