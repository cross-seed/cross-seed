import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-startup-tests-"));
const MIGRATED_CONFIG_COMMENT =
	"// This config.js file was imported into the cross-seed v7 database. Use the Web UI to view or change settings.\n\n";

type StartupEnv = {
	configDir: string;
	configPath: string;
	db: typeof import("../src/db.js").db;
	determineRuntimeConfig: typeof import("../src/startup.js").determineRuntimeConfig;
	getDbConfig: typeof import("../src/dbConfig.js").getDbConfig;
};

let currentDb: StartupEnv["db"] | undefined;

async function createStartupEnv(configDir?: string): Promise<StartupEnv> {
	configDir ??= await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { determineRuntimeConfig, handleExitSignal } =
		await import("../src/startup.js");
	// Each isolated module load registers process handlers; these tests manage
	// database cleanup themselves and must not accumulate shutdown handlers.
	process.off("SIGINT", handleExitSignal);
	process.off("SIGTERM", handleExitSignal);
	const { getDbConfig } = await import("../src/dbConfig.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	await db.migrate.latest();
	currentDb = db;

	return {
		configDir,
		configPath: join(configDir, "config.js"),
		db,
		determineRuntimeConfig,
		getDbConfig,
	};
}

describe.sequential("startup config migration", () => {
	afterEach(async () => {
		await currentDb?.destroy();
		currentDb = undefined;
		delete process.env.CONFIG_DIR;
	});

	it("renames config.js after importing file config into the database", async () => {
		const env = await createStartupEnv();
		const configContents = `
	export default {
		torznab: ["https://example.com/api?apikey=abc"],
	useClientTorrents: false,
};
`;
		await writeFile(env.configPath, configContents);

		const runtimeConfig = await env.determineRuntimeConfig({});

		await expect(readFile(env.configPath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(readFile(`${env.configPath}.bak`, "utf8")).resolves.toBe(
			`${MIGRATED_CONFIG_COMMENT}${configContents}`,
		);
		expect(runtimeConfig.torznab).toEqual([
			"https://example.com/api?apikey=abc",
		]);
		expect((await env.getDbConfig())?.torznab).toEqual([
			"https://example.com/api?apikey=abc",
		]);
	}, 15_000);

	it.each([
		["invalid JavaScript", "export default { torznab: ["],
		["invalid settings", "export default { delay: 1 };"],
		["invalid delay type", 'export default { delay: "oops" };'],
		["invalid source list", "export default { dataDirs: [123] };"],
		["invalid duration", 'export default { searchCadence: "oops" };'],
		["invalid boolean", 'export default { useClientTorrents: "false" };'],
		["invalid enum", 'export default { matchMode: "oops" };'],
		["missing dependency", 'import "./missing.js"; export default {};'],
		["invalid export", "export default null;"],
	])(
		"preserves configuration and retries after %s is repaired",
		async (_name, configContents) => {
			const env = await createStartupEnv();
			const originalSettings = await env.db("settings").select();
			await writeFile(env.configPath, configContents);

			await expect(env.determineRuntimeConfig({})).rejects.toThrow(
				"Failed to import configuration file",
			);
			await expect(env.getDbConfig()).resolves.toBeUndefined();
			expect(await env.db("settings").select()).toEqual(originalSettings);

			await expect(readFile(env.configPath, "utf8")).resolves.toBe(
				configContents,
			);
			await expect(
				readFile(`${env.configPath}.bak`, "utf8"),
			).rejects.toMatchObject({
				code: "ENOENT",
			});

			const repairedConfig =
				"export default { delay: 123, useClientTorrents: false };";
			await writeFile(env.configPath, repairedConfig);
			await env.db.destroy();
			// Preserve the on-disk state at a fresh path to avoid Node's native
			// ESM cache, which a real process restart would discard.
			const restartDir = await mkdtemp(join(TEST_ROOT, "restart-"));
			await cp(env.configDir, restartDir, { recursive: true });
			const restarted = await createStartupEnv(restartDir);
			await expect(
				restarted.determineRuntimeConfig({}),
			).resolves.toMatchObject({
				delay: 123,
				useClientTorrents: false,
			});
			await expect(restarted.getDbConfig()).resolves.toMatchObject({
				delay: 123,
			});
			await expect(
				readFile(`${restarted.configPath}.bak`, "utf8"),
			).resolves.toBe(`${MIGRATED_CONFIG_COMMENT}${repairedConfig}`);
		},
	);

	it("creates default settings when no config file exists", async () => {
		const env = await createStartupEnv();
		await expect(env.determineRuntimeConfig({})).resolves.toMatchObject({
			delay: 30,
		});
		await expect(env.getDbConfig()).resolves.toBeDefined();
	});

	it.each([false, true])(
		"imports v6 config with a legacy API key (migration already applied: %s)",
		async (alreadyApplied) => {
			const env = await createStartupEnv();
			const apiKey = "a".repeat(32);
			await env.db("settings").update({
				apikey: apiKey,
				settings_json: alreadyApplied
					? JSON.stringify({ apiKey })
					: null,
			});
			if (!alreadyApplied) {
				const migration =
					await import("../src/migrations/17-api-key-settings-json.js");
				await migration.default.up(env.db);
			}
			await writeFile(
				env.configPath,
				'export default { delay: 123, useClientTorrents: false, torznab: ["https://example.com/api?apikey=abc"] };',
			);
			await expect(env.determineRuntimeConfig({})).resolves.toMatchObject(
				{ delay: 123, apiKey },
			);
			await expect(env.getDbConfig()).resolves.toMatchObject({
				delay: 123,
				apiKey,
			});
			expect(
				await env
					.db("indexer")
					.where({ url: "https://example.com/api" }),
			).toHaveLength(1);
			await expect(
				readFile(`${env.configPath}.bak`, "utf8"),
			).resolves.toContain("delay: 123");
		},
	);

	it.each(["populated", "no legacy key", "no file"])(
		"keeps database settings authoritative: %s",
		async (kind) => {
			const env = await createStartupEnv();
			const apiKey = "b".repeat(32);
			const config =
				kind === "populated" ? { apiKey, delay: 456 } : { apiKey };
			await env.db("settings").update({
				apikey: kind === "no legacy key" ? null : apiKey,
				settings_json: JSON.stringify(config),
			});
			if (kind !== "no file")
				await writeFile(
					env.configPath,
					"export default { delay: 123 };",
				);
			await expect(env.determineRuntimeConfig({})).resolves.toMatchObject(
				{ apiKey, delay: kind === "populated" ? 456 : 30 },
			);
			await expect(env.getDbConfig()).resolves.toEqual(config);
		},
	);

	it("preserves the legacy key and file if recovery encounters invalid config", async () => {
		const env = await createStartupEnv();
		const apiKey = "c".repeat(32);
		await env.db("settings").update({
			apikey: apiKey,
			settings_json: JSON.stringify({ apiKey }),
		});
		const original = await env.db("settings").select();
		await writeFile(env.configPath, "export default { delay: 1 };");
		await expect(env.determineRuntimeConfig({})).rejects.toThrow(
			"Failed to import configuration file",
		);
		expect(await env.db("settings").select()).toEqual(original);
		await expect(readFile(env.configPath, "utf8")).resolves.toContain(
			"delay: 1",
		);
	});

	it("chooses a collision-safe backup filename", async () => {
		const env = await createStartupEnv();
		const configContents = `
export default {
	useClientTorrents: false,
};
`;
		await writeFile(env.configPath, configContents);
		await writeFile(`${env.configPath}.bak`, "previous backup");

		await env.determineRuntimeConfig({});

		await expect(readFile(`${env.configPath}.bak`, "utf8")).resolves.toBe(
			"previous backup",
		);
		await expect(readFile(`${env.configPath}.bak.1`, "utf8")).resolves.toBe(
			`${MIGRATED_CONFIG_COMMENT}${configContents}`,
		);
	});
	it("imports legacy durations, disabled values, aliases, and nullable paths", async () => {
		const env = await createStartupEnv();
		await writeFile(
			env.configPath,
			`export default { searchCadence: "2h", excludeOlder: null, seasonFromEpisodes: false, torrentDir: null, outputDir: null, linkDir: "/legacy/links", matchMode: "risky", useClientTorrents: false };`,
		);
		await expect(env.determineRuntimeConfig({})).resolves.toMatchObject({
			searchCadence: 7200000,
			excludeOlder: 0,
			seasonFromEpisodes: 0,
			linkDirs: ["/legacy/links"],
			matchMode: "flexible",
		});
	});
});
