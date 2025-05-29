import { randomBytes } from "node:crypto";
import { getDbConfig, setDbConfig } from "./dbConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

function generateApiKey(): string {
	return randomBytes(24).toString("hex");
}

export async function resetApiKey(): Promise<string> {
	const apikey = generateApiKey();
	const currentConfig = await getDbConfig();
	await setDbConfig({ ...currentConfig, apiKey: apikey });
	return apikey;
}

export async function getApiKey(): Promise<string> {
	const { apiKey: runtimeConfigApiKey } = getRuntimeConfig();
	if (runtimeConfigApiKey) return runtimeConfigApiKey;

	const { apiKey } = await getDbConfig();
	if (!apiKey) return resetApiKey();
	return apiKey;
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const apikey = await getApiKey();
	return apikey === keyToCheck;
}
