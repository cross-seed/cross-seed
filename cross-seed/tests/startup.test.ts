import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

async function createStartupEnv(): Promise<StartupEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy } = await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { determineRuntimeConfig } = await import("../src/startup.js");
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
	});

	it("leaves config.js untouched when file config import fails", async () => {
		const env = await createStartupEnv();
		const configContents = "export default { torznab: [";
		await writeFile(env.configPath, configContents);

		await env.determineRuntimeConfig({});

		await expect(readFile(env.configPath, "utf8")).resolves.toBe(
			configContents,
		);
		await expect(
			readFile(`${env.configPath}.bak`, "utf8"),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
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
