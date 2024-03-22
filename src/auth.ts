import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

function generateApiKey(): string {
	return randomBytes(24).toString("hex");
}

export async function resetApiKey(): Promise<string> {
	const apikey = generateApiKey();
	await db("settings").update({ apikey });
	return apikey;
}

export async function getApiKey(): Promise<string> {
	const { apiKey: runtimeConfigApiKey } = getRuntimeConfig();
	if (runtimeConfigApiKey) return runtimeConfigApiKey;

	const { apikey } = await db("settings").select("apikey").first();
	if (!apikey) return resetApiKey();
	return apikey;
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const apikey = await getApiKey();
	return apikey === keyToCheck;
}
