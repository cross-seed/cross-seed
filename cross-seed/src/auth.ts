import { randomBytes } from "node:crypto";
import { z } from "zod";
import { updateDbConfig } from "./dbConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { db } from "./db.js";
import { CrossSeedError } from "./errors.js";

export const apiKeySchema = z
	.string()
	.min(24, "API key must be at least 24 characters");

function generateApiKey(): string {
	return randomBytes(24).toString("hex");
}

export async function setApiKey(apiKey: string): Promise<string> {
	const validation = apiKeySchema.safeParse(apiKey);
	if (!validation.success) {
		throw new CrossSeedError(
			validation.error.issues[0]?.message ?? "Invalid API key",
		);
	}

	const validatedApiKey = validation.data;
	await updateDbConfig({ apiKey: validatedApiKey });
	return validatedApiKey;
}

export async function resetApiKey(): Promise<string> {
	return setApiKey(generateApiKey());
}

export async function getApiKey(): Promise<string> {
	const row = await db("settings").select("apikey", "settings_json").first();
	if (row?.settings_json != null) {
		const { apiKey } = JSON.parse(row.settings_json) as {
			apiKey?: unknown;
		};
		if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;
	}

	// Migration 17 copies legacy settings.apikey into settings_json.apiKey.
	// Keep this fallback defensive for interrupted or manually restored DBs.
	if (row?.apikey) return row.apikey;

	const { apiKey: runtimeConfigApiKey } = getRuntimeConfig();
	if (runtimeConfigApiKey) return runtimeConfigApiKey;

	// No API key found anywhere, generate one
	return resetApiKey();
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const apikey = await getApiKey();
	return apikey === keyToCheck;
}
