import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";

export function isDbConfigEnabled(): boolean {
	return process.env.DB_CONFIG === "true";
}

export async function getDbConfig(): Promise<Partial<RuntimeConfig>> {
	const row = await db("settings").select("settings_json").first();
	if (!row || !row.settings_json) {
		return {};
	}
	return JSON.parse(row.settings_json);
}

export async function setDbConfig(
	config: Partial<RuntimeConfig>,
): Promise<void> {
	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		if (existingRow) {
			await trx("settings").update({
				settings_json: JSON.stringify(config),
			});
		} else {
			await trx("settings").insert({
				settings_json: JSON.stringify(config),
			});
		}
	});
}
