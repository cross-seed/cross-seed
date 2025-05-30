import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";

export function isDbConfigEnabled(): boolean {
	return process.env.DB_CONFIG === "true";
}

export async function getDbConfig(): Promise<RuntimeConfig> {
	const row = await db("settings").select("settings_json").first();
	if (!row || !row.settings_json) {
		throw new Error(
			"No configuration found in database. Please save a configuration first.",
		);
	}
	return JSON.parse(row.settings_json);
}

export async function setDbConfig(config: RuntimeConfig): Promise<void> {
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

export async function updateDbConfig(
	partialConfig: Partial<RuntimeConfig>,
): Promise<void> {
	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		if (existingRow) {
			const currentConfig = JSON.parse(existingRow.settings_json);
			const updatedConfig = { ...currentConfig, ...partialConfig };
			await trx("settings").update({
				settings_json: JSON.stringify(updatedConfig),
			});
		} else {
			await trx("settings").insert({
				settings_json: JSON.stringify(partialConfig),
			});
		}
	});
}
