import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";

export function isDbConfigEnabled(): boolean {
	return process.env.DB_CONFIG === "true";
}

export async function getDbConfig(): Promise<RuntimeConfig> {
	const row = await db("settings").select("settings_json").first();
	console.log("getDbConfig: row from database:", { row });

	if (!row || !row.settings_json) {
		throw new Error(
			"No configuration found in database. Please save a configuration first.",
		);
	}

	const config = JSON.parse(row.settings_json);
	console.log("getDbConfig: parsed config keys:", Object.keys(config));
	return config;
}

export async function setDbConfig(config: RuntimeConfig): Promise<void> {
	console.log("setDbConfig: saving config with keys:", Object.keys(config));

	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		console.log("setDbConfig: existing row:", { existingRow });

		if (existingRow) {
			console.log("setDbConfig: updating existing row");
			await trx("settings").update({
				settings_json: JSON.stringify(config),
			});
		} else {
			console.log("setDbConfig: inserting new row");
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(config),
			});
		}
	});

	console.log("setDbConfig: successfully saved config to database");
}

export async function updateDbConfig(
	partialConfig: Partial<RuntimeConfig>,
): Promise<void> {
	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		if (existingRow) {
			const currentConfig = existingRow.settings_json
				? JSON.parse(existingRow.settings_json)
				: {};
			const updatedConfig = { ...currentConfig, ...partialConfig };
			await trx("settings").update({
				settings_json: JSON.stringify(updatedConfig),
			});
		} else {
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(partialConfig),
			});
		}
	});
}
