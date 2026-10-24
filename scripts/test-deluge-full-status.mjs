// Run only against an isolated, disposable Deluge WebUI:
// DELUGE_TEST_URL=http://:deluge@127.0.0.1:18112/json node scripts/test-deluge-full-status.mjs
// Requires a backend build. Adds a paused synthetic torrent and disconnects the WebUI.
import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Deluge from "../cross-seed/dist/clients/Deluge.js";
import { initializeLogger } from "../cross-seed/dist/logger.js";

const url = process.env.DELUGE_TEST_URL;
assert(url, "Set DELUGE_TEST_URL to an isolated test WebUI (never production)");
initializeLogger({ verbose: false });
const client = new Deluge(url, "live-test", 0, false);
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
	const body = JSON.parse(options.body);
	calls.push(body);
	return realFetch(url, options);
};
const rpc = async (method, params = []) =>
	(await client.call(method, params, 0)).unwrapOrThrow();
function encode(value) {
	if (Buffer.isBuffer(value))
		return Buffer.concat([Buffer.from(`${value.length}:`), value]);
	if (typeof value === "string") return encode(Buffer.from(value));
	if (typeof value === "number") return Buffer.from(`i${value}e`);
	return Buffer.concat([
		Buffer.from("d"),
		...Object.keys(value)
			.sort()
			.flatMap((key) => [encode(key), encode(value[key])]),
		Buffer.from("e"),
	]);
}
const info = {
	name: "Cross.Seed.Cache.Proof.2026.mkv",
	length: 4,
	"piece length": 16384,
	pieces: createHash("sha1").update("test").digest(),
	private: 1,
};
const hash = createHash("sha1").update(encode(info)).digest("hex");
let added = false;
try {
	await Promise.all(
		Array.from({ length: 10 }, () => client.getAllTorrents()),
	);
	assert.equal(calls.filter((c) => c.method === "auth.login").length, 1);
	if (!(await rpc("core.get_session_state")).includes(hash)) {
		await rpc("core.add_torrent_file", [
			"proof.torrent",
			encode({ info }).toString("base64"),
			{ add_paused: true, download_location: "/data" },
		]);
		added = true;
	}
	const host = (await rpc("web.get_hosts"))[0][0];
	await rpc("web.disconnect");
	await rpc("web.connect", [host]);
	const fields = ["name", "save_path", "files", "total_size", "state"];
	await rpc("core.get_torrent_status", [hash, fields, true]);
	const start = calls.length;
	const cached = await rpc("web.get_torrent_status", [hash, fields]);
	assert(
		!fields.every((field) => field in cached),
		"Expected constructed cache divergence",
	);
	const full = await rpc("core.get_torrent_status", [hash, fields, false]);
	assert(fields.every((field) => field in full));
	assert((await client.isTorrentInClient(hash)).unwrap());
	assert.equal(
		(
			await client.getDownloadDir(
				{ infoHash: hash },
				{ onlyCompleted: false },
			)
		).unwrap(),
		"/data",
	);
	assert(
		(await client.getAllDownloadDirs({ onlyCompleted: false })).has(hash),
	);
	assert(
		!calls
			.slice(start)
			.some((c) => ["web.connect", "web.disconnect"].includes(c.method)),
	);

	await rpc("auth.delete_session");
	let from = calls.length;
	const afterExpiry = await Promise.all(
		Array.from({ length: 10 }, () => client.getAllTorrents()),
	);
	assert(
		afterExpiry.every((torrents) =>
			torrents.some((t) => t.infoHash === hash),
		),
	);
	assert.equal(
		calls.slice(from).filter((c) => c.method === "auth.login").length,
		1,
	);

	await rpc("web.disconnect");
	from = calls.length;
	const afterDisconnect = await Promise.all(
		Array.from({ length: 10 }, () => client.getAllTorrents()),
	);
	assert(
		afterDisconnect.every((torrents) =>
			torrents.some((t) => t.infoHash === hash),
		),
	);
	assert.equal(
		calls.slice(from).filter((c) => c.method === "web.connect").length,
		1,
	);
	assert.equal(
		calls.slice(from).filter((c) => c.method === "auth.login").length,
		0,
	);
	console.log(
		JSON.stringify(
			{
				cacheKeys: Object.keys(cached),
				fullKeys: Object.keys(full),
				concurrentCallers: 10,
				expiryLogins: 1,
				daemonReconnects: 1,
				passed: true,
			},
			null,
			2,
		),
	);
} finally {
	if (added) await rpc("core.remove_torrent", [hash, true]);
	globalThis.fetch = realFetch;
}
