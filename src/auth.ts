import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

function generateApiKey(): string {
	return randomBytes(32).toString("hex");
}

export async function resetApiKey(): Promise<string> {
	const apikey = generateApiKey();
	await db("settings").update({ apikey });
	return apikey;
}

export async function getApiKeyFromDatabase(): Promise<string> {
	const { apikey } = await db("settings").select("apikey").first();
	if (!apikey) return resetApiKey();
	return apikey;
}

export async function checkApiKey(keyToCheck: string): Promise<boolean> {
	const { auth } = getRuntimeConfig();
	if (!auth) return true;
	const apikey = await getApiKeyFromDatabase();
	return apikey === keyToCheck;
}
