import { describe, expect, it } from "vitest";
import { RUNTIME_CONFIG_SCHEMA } from "./configSchema.js";

const { blockList, torrentClients } = RUNTIME_CONFIG_SCHEMA.shape;

describe("blocklist settings", () => {
	it("normalizes only explicit info hashes and preserves case-sensitive matching", () => {
		const hash = "Ab".repeat(20);
		expect(
			blockList.parse([
				`infoHash:${hash}`,
				"name:My.Show",
				"nameRegex:^My\\.Show$",
				"folderRegex:Season [0-9]+",
				"category:",
				"tag:",
				"legacy:My.Show",
				"My.Show",
			]),
		).toEqual([
			`infoHash:${hash.toLowerCase()}`,
			"name:My.Show",
			"nameRegex:^My\\.Show$",
			"folderRegex:Season [0-9]+",
			"category:",
			"tag:",
			"legacy:My.Show",
			"My.Show",
		]);
	});

	it.each([
		"nameRegex:[",
		"folderRegex:(",
		"unknown:value",
		"infoHash:not-a-hash",
		"name:",
		"nameRegex:",
		"folderRegex:",
		"",
		"   ",
	])("rejects malformed entry %j at its array position", (entry) => {
		const result = blockList.safeParse(["name:valid", entry]);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error.issues[0].path).toEqual([1]);
	});
});

describe("torrent-client settings", () => {
	it.each([
		"qbittorrent:http://user:password@localhost:8080",
		"qbittorrent:readonly:https://localhost/qbit/",
		"transmission:http://localhost:9091/transmission/rpc",
		"deluge:https://:password@localhost:8112/",
		"rtorrent:http://localhost/RPC2",
		"rtorrent:readonly:scgi://localhost:5000",
		"rtorrent:scgi://[::1]:5000",
		"rtorrent:scgi:///run/rtorrent%20socket.sock",
		"qbittorrent:http://user:p%25ss@localhost",
		"qbittorrent:http://localhost",
	])("retains supported endpoint %j exactly", (entry) => {
		expect(torrentClients.parse([entry])).toEqual([entry]);
	});

	it("allows an empty client list during onboarding", () => {
		expect(torrentClients.parse([])).toEqual([]);
	});

	it.each([
		"nonsense",
		"unknown:http://localhost",
		"http://localhost",
		"qbittorrent:",
		"qbittorrent:localhost:8080",
		"qbittorrent:http://",
		"qbittorrent:ftp://localhost",
		"qbittorrent:scgi://localhost:5000",
		"rtorrent:scgi://localhost",
		"rtorrent:scgi://localhost:0",
		"rtorrent:scgi://localhost:65536",
		"rtorrent:scgi:///",
		"rtorrent:scgi:///run/socket%ZZ",
	])(
		"rejects malformed endpoint %j without exposing credentials",
		(entry) => {
			const result = torrentClients.safeParse([entry]);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].path).toEqual([0]);
				expect(result.error.issues[0].message).not.toContain(entry);
			}
		},
	);
});
