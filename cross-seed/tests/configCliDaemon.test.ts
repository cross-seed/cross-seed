import type { DaemonDescriptor } from "../src/configDaemonDiscovery.js";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import {
	readSettings,
	setSetting,
	unsetSetting,
	importSettings,
} from "../src/configCli.js";
import { getDefaultRuntimeConfig } from "../src/configuration.js";

let server: Server | undefined;
let directory: string;
afterEach(async () => {
	vi.restoreAllMocks();
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server!.close((e) => (e ? reject(e) : resolve())),
		);
		server = undefined;
	}
	if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(status = 200) {
	directory = await mkdtemp(join(tmpdir(), "config-cli-daemon-"));
	const filename = join(directory, "cross-seed.db");
	const db = new DatabaseSync(filename);
	db.exec(
		`CREATE TABLE settings(settings_json TEXT); INSERT INTO settings VALUES('{"maxDataDepth":3}');`,
	);
	db.close();
	const calls: {
		url: string;
		body: unknown;
		authorization: string | undefined;
	}[] = [];
	server = createServer((req, res) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of req)
				chunks.push(Buffer.from(chunk as Uint8Array));
			const body = Buffer.concat(chunks).toString();
			calls.push({
				url: req.url!,
				body: body ? JSON.parse(body) : undefined,
				authorization: req.headers.authorization,
			});
			res.writeHead(status, { "content-type": "application/json" });
			res.end(
				JSON.stringify(
					status === 200
						? {
								result: {
									data:
										req.method === "GET"
											? {
													config: {
														...getDefaultRuntimeConfig(),
														maxDataDepth: 7,
													},
												}
											: { success: true },
								},
							}
						: { error: { message: "rejected by daemon" } },
				),
			);
		})().catch((e) => res.destroy(e as Error));
	});
	await new Promise<void>((resolve) =>
		server!.listen(0, "127.0.0.1", resolve),
	);
	const address = server.address() as { port: number };
	await writeFile(
		join(directory, "daemon.json"),
		JSON.stringify({
			pid: process.pid,
			url: `http://127.0.0.1:${address.port}/custom/api/trpc`,
			token: "local-secret",
		}),
	);
	return { filename, calls };
}
it("routes reads, patches, unset and replacement through the daemon without writing SQLite", async () => {
	const { filename, calls } = await setup();
	expect((await readSettings(filename)).maxDataDepth).toBe(7);
	expect(await setSetting(filename, "maxDataDepth", 4)).toBe("daemon");
	expect(await unsetSetting(filename, "torrentDir")).toBe("daemon");
	const input = join(directory, "import.json");
	await writeFile(input, '{"maxDataDepth":5}');
	expect(await importSettings(filename, input)).toBe("daemon");
	expect(calls.map((c) => c.url)).toEqual([
		"/custom/api/trpc/settings.get",
		"/custom/api/trpc/settings.save",
		"/custom/api/trpc/settings.unset",
		"/custom/api/trpc/settings.replace",
	]);
	expect(calls.every((c) => c.authorization === "Bearer local-secret")).toBe(
		true,
	);
	expect(calls[1].body).toEqual({ maxDataDepth: 4 });
	expect(calls[2].body).toEqual({ key: "torrentDir" });
	expect(calls[3].body).toEqual({
		...getDefaultRuntimeConfig(),
		maxDataDepth: 5,
	});
	const db = new DatabaseSync(filename, { readOnly: true });
	expect(
		db.prepare("SELECT settings_json FROM settings").get()?.settings_json,
	).toBe('{"maxDataDepth":3}');
	db.close();
});
it.each([401, 400, 500])(
	"does not fall back to SQLite after HTTP %s",
	async (status) => {
		const { filename } = await setup(status);
		const before = await readFile(filename);
		await expect(setSetting(filename, "maxDataDepth", 4)).rejects.toThrow(
			"No offline write attempted",
		);
		expect(await readFile(filename)).toEqual(before);
	},
);
it("does not fall back when the discovered live daemon is unreachable", async () => {
	const { filename } = await setup();
	await new Promise<void>((resolve) => server!.close(() => resolve()));
	server = undefined;
	const before = await readFile(filename);
	await expect(setSetting(filename, "maxDataDepth", 4)).rejects.toThrow();
	expect(await readFile(filename)).toEqual(before);
});
it("uses SQLite with no discovery file", async () => {
	const { filename } = await setup();
	await rm(join(directory, "daemon.json"));
	expect(await setSetting(filename, "maxDataDepth", 4)).toBe("offline");
	expect((await readSettings(filename)).maxDataDepth).toBe(4);
});

it("uses offline recovery when a crashed daemon left a descriptor", async () => {
	const { filename } = await setup();
	const child = spawnSync(
		process.execPath,
		["-e", "console.log(process.pid)"],
		{ encoding: "utf8" },
	);
	expect(child.status).toBe(0);
	const path = join(directory, "daemon.json");
	const descriptor = JSON.parse(
		await readFile(path, "utf8"),
	) as DaemonDescriptor;
	descriptor.pid = Number(child.stdout.trim());
	await writeFile(path, JSON.stringify(descriptor));
	expect(await setSetting(filename, "maxDataDepth", 4)).toBe("offline");
});
it("never writes offline after a daemon request times out", async () => {
	const { filename } = await setup();
	const before = await readFile(filename);
	vi.spyOn(globalThis, "fetch").mockRejectedValue(
		new DOMException("Timed out", "TimeoutError"),
	);
	await expect(setSetting(filename, "maxDataDepth", 4)).rejects.toThrow(
		"Timed out",
	);
	expect(await readFile(filename)).toEqual(before);
});

it("refuses offline writes when a live daemon has HTTP disabled", async () => {
	const { filename } = await setup();
	const path = join(directory, "daemon.json");
	const descriptor = JSON.parse(
		await readFile(path, "utf8"),
	) as DaemonDescriptor;
	descriptor.url = null;
	await writeFile(path, JSON.stringify(descriptor));
	const before = await readFile(filename);
	await expect(setSetting(filename, "maxDataDepth", 4)).rejects.toThrow(
		"HTTP disabled",
	);
	expect(await readFile(filename)).toEqual(before);
});
