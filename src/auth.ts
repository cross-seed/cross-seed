import { randomBytes } from "node:crypto";
import { getDbConfig, updateDbConfig } from "./dbConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

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

	try {
		const { apiKey } = await getDbConfig();
		if (!apiKey) return await resetApiKey();
		return apiKey;
	} catch {
		// No config exists yet, create one with just the API key
		return await resetApiKey();
	}
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const apikey = await getApiKey();
	return apikey === keyToCheck;
}
