import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpServer } from "../src/server.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { index, reload } = vi.hoisted(() => ({
	index: vi.fn().mockResolvedValue(undefined),
	reload: vi.fn(),
}));
vi.mock("../src/torrent.js", async (original) => ({
	...(await original<typeof import("../src/torrent.js")>()),
	indexTorrentsAndDataDirs: index,
}));
vi.mock("../src/clients/TorrentClient.js", async (original) => ({
	...(await original<typeof import("../src/clients/TorrentClient.js")>()),
	reloadDownloadClients: reload,
}));

describe.sequential("local settings tRPC capability", () => {
	let app: HttpServer;
	let db: typeof import("../src/db.js").db;
	let logger: typeof import("../src/logger.js").logger;
	let runtime: typeof import("../src/runtimeConfig.js");
	let descriptor: import("../src/configDaemonDiscovery.js").DaemonDescriptor;
	let path: string;
	beforeEach(async () => {
		process.env.CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "settings-daemon-test-"),
		);
		vi.resetModules();
		index.mockClear();
		reload.mockClear();
		const config = await import("../src/configuration.js");
		config.createAppDirHierarchy();
		const logging = await import("../src/logger.js");
		logging.initializeLogger({ verbose: false });
		logger = logging.logger;
		logger.silent = true;
		({ db } = await import("../src/db.js"));
		await db.migrate.latest();
		runtime = await import("../src/runtimeConfig.js");
		runtime.setRuntimeConfig(config.getDefaultRuntimeConfig());
		const { setDbConfig } = await import("../src/dbConfig.js");
		await setDbConfig(config.getDefaultRuntimeConfig());
		const discovery = await import("../src/configDaemonDiscovery.js");
		const { createServer } = await import("../src/server.js");
		app = createServer("/cross-seed");
		path = discovery.daemonDescriptorPath();
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
		await app.listen({ port: 0, host: "127.0.0.1" });
		await vi.waitFor(async () => {
			descriptor = JSON.parse(
				await readFile(path, "utf8"),
			) as typeof descriptor;
		});
	});
	afterEach(async () => {
		await app?.close();
		logger?.close();
		await db?.destroy();
		delete process.env.CONFIG_DIR;
	});
	async function request(
		procedure: string,
		input?: unknown,
		token: string | undefined = descriptor.token,
	) {
		return fetch(`${descriptor.url}/${procedure}`, {
			method: input === undefined ? "GET" : "POST",
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				"Content-Type": "application/json",
			},
			...(input === undefined ? {} : { body: JSON.stringify(input) }),
		});
	}
	it("publishes actual port/base path privately and removes its own descriptor", async () => {
		expect(descriptor.url).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+\/cross-seed\/api\/trpc$/,
		);
		expect(descriptor.pid).toBe(process.pid);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		await app.close();
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("rejects missing/wrong tokens and does not grant broader settings access", async () => {
		expect((await request("settings.get", undefined, "")).status).toBe(401);
		expect(
			(await request("settings.get", undefined, "invalid")).status,
		).toBe(401);
		expect((await request("settings.get")).status).toBe(200);
		expect(
			(await request("config.show?input=%7B%7D", undefined, "")).status,
		).toBe(401);
		expect((await request("config.show?input=%7B%7D")).status).toBe(200);
		expect(
			(await request("config.set", { maxDataDepth: 3 }, "")).status,
		).toBe(401);

		expect((await request("settings.resetApiKey", {})).status).toBe(401);
	});
	it("updates persisted and runtime settings, schedules source refresh, and resets optional values", async () => {
		expect(
			(
				await request("settings.save", {
					dataDirs: ["/local/example"],
					useClientTorrents: false,
				})
			).status,
		).toBe(200);
		expect(runtime.getRuntimeConfig().dataDirs).toEqual(["/local/example"]);
		expect(index).toHaveBeenCalledWith({ startup: true });
		expect(reload).toHaveBeenCalledOnce();
		const read = (await (await request("settings.get")).json()) as {
			result: { data: { config: { dataDirs: string[] } } };
		};
		expect(read.result.data.config.dataDirs).toEqual(["/local/example"]);
		expect(
			(await request("settings.save", { torrentDir: "/local/torrents" }))
				.status,
		).toBe(200);
		expect(
			(await request("settings.unset", { key: "torrentDir" })).status,
		).toBe(200);
		expect(runtime.getRuntimeConfig().torrentDir).toBeUndefined();
		const { getDbConfig } = await import("../src/dbConfig.js");
		expect((await getDbConfig())?.torrentDir).toBeUndefined();
	});
	it("rejects invalid schemas, unknown keys, and legacy indexer writes", async () => {
		expect((await request("settings.save", { unknown: true })).ok).toBe(
			false,
		);
		expect(
			(await request("settings.save", { maxDataDepth: "invalid" })).ok,
		).toBe(false);
		expect((await request("settings.save", { torznab: [] })).ok).toBe(
			false,
		);
		expect(
			(
				await request("settings.replace", {
					torznab: ["http://example.test/api?apikey=key"],
				})
			).ok,
		).toBe(false);
		expect((await request("settings.unset", { key: "unknown" })).ok).toBe(
			false,
		);
		expect(reload).not.toHaveBeenCalled();
	});
	it("unset never reimports legacy indexers", async () => {
		await db("settings").update({
			settings_json: JSON.stringify({
				maxDataDepth: 3,
				torznab: ["http://127.0.0.1:1/api?apikey=legacy"],
			}),
		});
		expect(
			(await request("settings.unset", { key: "maxDataDepth" })).status,
		).toBe(200);
		expect(await db("indexer")).toHaveLength(0);
	});

	it("closes the listener when discovery cannot be published", async () => {
		await app.close();
		await mkdir(path);
		app = (await import("../src/server.js")).createServer();
		await expect(
			app.listen({ port: 0, host: "127.0.0.1" }),
		).rejects.toThrow();
		expect(app.server.listening).toBe(false);
	});

	it("advertises disabled HTTP so live daemons cannot be mistaken for offline", async () => {
		await app.close();
		const { publishDisabledSettingsCli } =
			await import("../src/configDaemonDiscovery.js");
		const cleanup = await publishDisabledSettingsCli();
		try {
			expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
				pid: process.pid,
				url: null,
			});
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		} finally {
			cleanup();
		}
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("preserves a replacement daemon descriptor when an older server closes", async () => {
		const newer = { ...descriptor, token: "new-process-token" };
		await writeFile(path, JSON.stringify(newer));
		await app.close();
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual(newer);
	});
});
