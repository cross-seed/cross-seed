import { mkdtemp, writeFile } from "node:fs/promises";
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

const apiKey = "parity-api-key-123456789012345";
for (const online of [false, true]) {
	describe.sequential(
		`settings contract via ${online ? "HTTP daemon" : "offline SQLite"}`,
		() => {
			let app: HttpServer | undefined;
			let db: typeof import("../src/db.js").db;
			let logger: typeof import("../src/logger.js").logger;
			let cli: typeof import("../src/configCli.js");
			let runtime: typeof import("../src/runtimeConfig.js");
			let filename: string;
			let directory: string;
			let initialRuntime: ReturnType<typeof runtime.getRuntimeConfig>;
			beforeEach(async () => {
				directory = await mkdtemp(join(tmpdir(), "settings-parity-"));
				process.env.CONFIG_DIR = directory;
				filename = join(directory, "cross-seed.db");
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
				initialRuntime = {
					...config.getDefaultRuntimeConfig(),
					apiKey,
				};
				runtime.setRuntimeConfig(initialRuntime);
				await store({ apiKey, torrentDir: "/unavailable/torrents" });
				await db.raw(
					"INSERT INTO indexer (url, apikey, enabled) VALUES (?, ?, ?)",
					["http://tracker.invalid/api", "tracker-secret", 1],
				);

				await db("user").insert({
					username: "parity",
					password: "preserved-password-hash",
				});
				await db.raw(
					"INSERT INTO decision (guid, decision, first_seen, last_seen) VALUES (?, ?, ?, ?)",
					["preserved-decision", "MATCH", 123, 456],
				);
				cli = await import("../src/configCli.js");
				if (online) {
					const { createServer } = await import("../src/server.js");
					app = createServer("/parity");
					await app.listen({ port: 0, host: "127.0.0.1" });
				}
			});
			afterEach(async () => {
				await app?.close();
				app = undefined;
				logger?.close();
				await db?.destroy();
				delete process.env.CONFIG_DIR;
			});
			async function store(overrides: Record<string, unknown>) {
				await db("settings").update({
					settings_json: JSON.stringify(overrides),
				});
			}
			async function unrelatedState() {
				return {
					indexers: await db("indexer"),
					users: await db("user"),
					history: await db("decision"),
				};
			}
			it("rejects unknown keys and invalid types without changing state or runtime", async () => {
				const before = await cli.readSettings(filename);
				for (const [key, value] of [
					["dataDir", []],
					["maxDataDepth", 0],
					["maxDataDepth", "3"],
					["dataDirs", "/media"],
					["torznab", []],
				] as const) {
					await expect(
						cli.setSetting(filename, key, value),
					).rejects.toThrow();
				}
				await expect(
					cli.unsetSetting(filename, "notStoredAnywhere"),
				).rejects.toThrow();
				expect(await cli.readSettings(filename)).toEqual(before);
				expect(runtime.getRuntimeConfig()).toEqual(initialRuntime);
				expect(index).not.toHaveBeenCalled();
				expect(reload).not.toHaveBeenCalled();
			});
			it("rejects malformed blocklists and clients before any persisted or live change", async () => {
				const before = await db("settings").first();
				const unrelated = await unrelatedState();
				for (const [key, value] of [
					["blockList", ["nameRegex:["]],
					["blockList", ["folderRegex:("]],
					["blockList", ["unknown:value"]],
					["torrentClients", ["nonsense"]],
					["torrentClients", ["unknown:http://localhost"]],
					["torrentClients", ["qbittorrent:ftp://localhost"]],
					["torrentClients", ["rtorrent:scgi://localhost"]],
				] as const) {
					await expect(
						cli.setSetting(filename, key, value),
					).rejects.toThrow();
					expect(await db("settings").first()).toEqual(before);
				}
				expect(await unrelatedState()).toEqual(unrelated);
				expect(runtime.getRuntimeConfig()).toEqual(initialRuntime);
				expect(index).not.toHaveBeenCalled();
				expect(reload).not.toHaveBeenCalled();
			});
			it("normalizes stored hashes so the real blocklist matcher excludes them", async () => {
				const hash = "Ab".repeat(20);
				await cli.setSetting(filename, "blockList", [
					`infoHash:${hash}`,
					"name:CaseSensitive",
				]);
				const blockList = (await cli.readSettings(filename))
					.blockList as string[];
				expect(blockList).toEqual([
					`infoHash:${hash.toLowerCase()}`,
					"name:CaseSensitive",
				]);
				const { findBlockedStringInReleaseMaybe } =
					await import("../src/preFilter.js");
				expect(
					findBlockedStringInReleaseMaybe(
						{
							title: "Other.Title",
							name: "Other.Title",
							infoHash: hash.toLowerCase(),
							files: [],
							length: 0,
						},
						blockList,
					),
				).toBe(`infoHash:${hash.toLowerCase()}`);
				if (online)
					expect(runtime.getRuntimeConfig().blockList).toEqual(
						blockList,
					);
			});
			it("rejects malformed replacement imports atomically", async () => {
				const before = await db("settings").first();
				const path = join(directory, "invalid-settings.json");
				for (const invalid of [
					{ blockList: ["nameRegex:["] },
					{ torrentClients: ["nonsense"] },
				]) {
					await writeFile(
						path,
						JSON.stringify({ apiKey, maxDataDepth: 4, ...invalid }),
					);
					await expect(
						cli.importSettings(filename, path),
					).rejects.toThrow();
					expect(await db("settings").first()).toEqual(before);
				}
				expect(runtime.getRuntimeConfig()).toEqual(initialRuntime);
				expect(reload).not.toHaveBeenCalled();
			});
			it("repairs invalid known values and removes unknown stored overrides", async () => {
				await store({ apiKey, maxDataDepth: 0 });
				expect((await cli.readSettings(filename)).maxDataDepth).toBe(0);
				await cli.setSetting(filename, "maxDataDepth", 3);
				expect((await cli.readSettings(filename)).maxDataDepth).toBe(3);
				await store({ apiKey, unknownStored: true });
				await cli.unsetSetting(filename, "unknownStored");
				expect(await cli.readSettings(filename)).toEqual({ apiKey });
			});
			it("resets optional values and preserves unrelated state with online-only runtime effects", async () => {
				const before = await unrelatedState();
				await cli.setSetting(filename, "dataDirs", [
					"/unavailable/new",
				]);
				await cli.unsetSetting(filename, "torrentDir");
				expect(
					(await cli.readSettings(filename, true)).torrentDir,
				).toBeUndefined();
				expect((await cli.readSettings(filename)).apiKey).toBe(apiKey);
				expect(await unrelatedState()).toEqual(before);
				if (online) {
					expect(runtime.getRuntimeConfig().dataDirs).toEqual([
						"/unavailable/new",
					]);
					expect(
						runtime.getRuntimeConfig().torrentDir,
					).toBeUndefined();
					expect(reload).toHaveBeenCalled();
					expect(index).toHaveBeenCalledWith({ startup: true });
				} else {
					expect(runtime.getRuntimeConfig()).toEqual(initialRuntime);
					expect(index).not.toHaveBeenCalled();
					expect(reload).not.toHaveBeenCalled();
				}
			});
			it("replaces malformed JSON without reading it and rejects invalid imports atomically", async () => {
				await db("settings").update({ settings_json: "{broken" });
				const before = await unrelatedState();
				const path = join(directory, "repair.json");
				await writeFile(path, JSON.stringify({ maxDataDepth: 0 }));
				await expect(
					cli.importSettings(filename, path),
				).rejects.toThrow();
				expect((await db("settings").first())?.settings_json).toBe(
					"{broken",
				);
				await writeFile(
					path,
					JSON.stringify({ apiKey, maxDataDepth: 4 }),
				);
				await cli.importSettings(filename, path);
				expect(await cli.readSettings(filename)).toEqual({
					apiKey,
					maxDataDepth: 4,
				});
				expect(await unrelatedState()).toEqual(before);
			});
			it("preserves independent concurrent updates while unsetting a different value", async () => {
				await Promise.all([
					cli.setSetting(filename, "maxDataDepth", 4),
					cli.setSetting(filename, "verbose", true),
					cli.unsetSetting(filename, "torrentDir"),
				]);
				expect(await cli.readSettings(filename)).toEqual({
					apiKey,
					maxDataDepth: 4,
					verbose: true,
				});
				if (online)
					expect(runtime.getRuntimeConfig()).toMatchObject({
						maxDataDepth: 4,
						verbose: true,
					});
			});
			it("runs generated typed commands against the selected transport", async () => {
				const command = cli.createConfigCommand(filename);
				command.exitOverride();
				command.configureOutput({
					writeErr: () => undefined,
					writeOut: () => undefined,
				});
				await command.parseAsync(
					[
						"set",
						"--max-data-depth",
						"5",
						"--no-use-client-torrents",
						"--data-dirs",
						"/missing/generated",
					],
					{ from: "user" },
				);
				expect(await cli.readSettings(filename)).toMatchObject({
					maxDataDepth: 5,
					useClientTorrents: false,
					dataDirs: ["/missing/generated"],
				});
				if (online)
					expect(runtime.getRuntimeConfig().maxDataDepth).toBe(5);
				else expect(runtime.getRuntimeConfig()).toEqual(initialRuntime);
			});

			if (online) {
				it("reports post-commit application failure without replaying the write offline", async () => {
					await db.raw("CREATE TABLE parity_writes (value TEXT)");
					await db.raw(
						"CREATE TRIGGER parity_audit AFTER UPDATE ON settings BEGIN INSERT INTO parity_writes VALUES (NEW.settings_json); END",
					);
					reload.mockImplementationOnce(() => {
						throw new Error("simulated runtime reload failure");
					});
					await expect(
						cli.setSetting(filename, "verbose", true),
					).rejects.toThrow();
					expect((await cli.readSettings(filename)).verbose).toBe(
						true,
					);
					expect(await db("parity_writes")).toHaveLength(1);
					await cli.setSetting(filename, "maxDataDepth", 4);
					expect(
						(await cli.readSettings(filename)).maxDataDepth,
					).toBe(4);
					expect(await db("parity_writes")).toHaveLength(2);
				});
			}
		},
	);
}
