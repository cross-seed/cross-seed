import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-auth-tests-"));

type AuthEnv = {
	db: typeof import("../src/db.js").db;
	getApiKey: typeof import("../src/auth.js").getApiKey;
	resetApiKey: typeof import("../src/auth.js").resetApiKey;
	setApiKey: typeof import("../src/auth.js").setApiKey;
	createDevLogin: typeof import("../src/devLogin.js").createDevLogin;
	getDbConfig: typeof import("../src/dbConfig.js").getDbConfig;
	getDefaultRuntimeConfig: typeof import("../src/configuration.js").getDefaultRuntimeConfig;
	setRuntimeConfig: typeof import("../src/runtimeConfig.js").setRuntimeConfig;
	validateSession: typeof import("../src/userAuth.js").validateSession;
	apiKeySettingsJsonMigration: typeof import("../src/migrations/17-api-key-settings-json.js").default;
};

let currentDb: AuthEnv["db"] | undefined;

async function createAuthEnv(): Promise<AuthEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy, getDefaultRuntimeConfig } =
		await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { getApiKey, resetApiKey, setApiKey } =
		await import("../src/auth.js");
	const { createDevLogin } = await import("../src/devLogin.js");
	const { getDbConfig } = await import("../src/dbConfig.js");
	const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
	const { validateSession } = await import("../src/userAuth.js");
	const { default: apiKeySettingsJsonMigration } =
		await import("../src/migrations/17-api-key-settings-json.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	await db.migrate.latest();
	currentDb = db;

	return {
		db,
		getApiKey,
		resetApiKey,
		setApiKey,
		createDevLogin,
		getDbConfig,
		getDefaultRuntimeConfig,
		setRuntimeConfig,
		validateSession,
		apiKeySettingsJsonMigration,
	};
}

describe.sequential("api key management", () => {
	afterEach(async () => {
		await currentDb?.destroy();
		currentDb = undefined;
		delete process.env.CONFIG_DIR;
	});

	it("reads the database-backed active API key before stale runtime config", async () => {
		const env = await createAuthEnv();
		const activeApiKey = "a".repeat(24);

		env.setRuntimeConfig({
			...env.getDefaultRuntimeConfig(),
			apiKey: "b".repeat(24),
		});
		await env.db("settings").update({
			apikey: "c".repeat(24),
			settings_json: JSON.stringify({ apiKey: activeApiKey }),
		});

		await expect(env.getApiKey()).resolves.toBe(activeApiKey);
	});

	it("copies the legacy settings.apikey into settings_json when missing", async () => {
		const env = await createAuthEnv();
		const legacyApiKey = "legacy-api-key".repeat(2);

		await env.db("settings").update({
			apikey: legacyApiKey,
			settings_json: JSON.stringify({ useClientTorrents: false }),
		});

		await env.apiKeySettingsJsonMigration.up(env.db);

		expect(await env.getDbConfig()).toMatchObject({
			apiKey: legacyApiKey,
			useClientTorrents: false,
		});
	});

	it("does not overwrite an existing settings_json API key with the legacy column", async () => {
		const env = await createAuthEnv();
		const activeApiKey = "active-api-key".repeat(2);

		await env.db("settings").update({
			apikey: "legacy-api-key".repeat(2),
			settings_json: JSON.stringify({ apiKey: activeApiKey }),
		});

		await env.apiKeySettingsJsonMigration.up(env.db);

		expect((await env.getDbConfig())?.apiKey).toBe(activeApiKey);
	});

	it("sets and resets the same API key source used by readers", async () => {
		const env = await createAuthEnv();
		const configuredApiKey = "d".repeat(24);

		await expect(env.setApiKey(configuredApiKey)).resolves.toBe(
			configuredApiKey,
		);
		await expect(env.getApiKey()).resolves.toBe(configuredApiKey);
		expect((await env.getDbConfig())?.apiKey).toBe(configuredApiKey);

		const resetApiKey = await env.resetApiKey();

		expect(resetApiKey).not.toBe(configuredApiKey);
		expect(resetApiKey).toHaveLength(48);
		await expect(env.getApiKey()).resolves.toBe(resetApiKey);
		expect((await env.getDbConfig())?.apiKey).toBe(resetApiKey);
	});

	it("creates a browser-openable development login for a real session", async () => {
		const env = await createAuthEnv();

		const output = await env.createDevLogin({
			origin: "http://localhost:5173",
			redirectTo: "/settings/general",
			user: "dev-user",
		});
		const cookie = output.match(/Cookie: cross-seed-session=([a-f0-9]+)/);

		expect(output).toContain("Dev login created for dev-user");
		expect(output).toContain("http://localhost:5173/api/dev-login/");
		expect(output).toContain("redirectTo=%2Fsettings%2Fgeneral");
		expect(cookie?.[1]).toBeDefined();
		await expect(env.validateSession(cookie![1])).resolves.toMatchObject({
			username: "dev-user",
		});
	});
});
