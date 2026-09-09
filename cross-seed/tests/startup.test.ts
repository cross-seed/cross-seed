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
	const { determineRuntimeConfig, exitGracefully } =
		await import("../src/startup.js");
	// Each isolated module load registers process handlers; these tests manage
	// database cleanup themselves and must not accumulate shutdown handlers.
	process.off("SIGINT", exitGracefully);
	process.off("SIGTERM", exitGracefully);
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
});
