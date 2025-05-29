import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";

export async function getDbConfig(): Promise<Partial<RuntimeConfig>> {
	const { settings_json } = (await db("settings")
		.select("settings_json")
		.first())!;
	return JSON.parse(settings_json);
}

export async function setDbConfig(
	config: Partial<RuntimeConfig>,
): Promise<void> {
	await db("settings").update({ settings_json: JSON.stringify(config) });
}
