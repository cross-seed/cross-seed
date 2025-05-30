import { randomBytes } from "node:crypto";
import { getDbConfig, updateDbConfig } from "./dbConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { db } from "./db.js";

function generateApiKey(): string {
	return randomBytes(24).toString("hex");
}

export async function resetApiKey(): Promise<string> {
	const apikey = generateApiKey();
	await updateDbConfig({ apiKey: apikey });
	return apikey;
}

export async function getApiKey(): Promise<string> {
	const { apiKey: runtimeConfigApiKey } = getRuntimeConfig();
	if (runtimeConfigApiKey) return runtimeConfigApiKey;

	// Try new JSON config first
	try {
		const { apiKey } = await getDbConfig();
		if (apiKey) return apiKey;
	} catch {
		// Fall back to old apikey column
		const row = await db("settings").select("apikey").first();
		if (row?.apikey) return row.apikey;
	}

	// No API key found anywhere, generate one
	return resetApiKey();
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const apikey = await getApiKey();
	return apikey === keyToCheck;
}
