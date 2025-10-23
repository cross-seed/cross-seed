import { applyDefaults, stripDefaults } from "./configuration.js";
import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";
import { omitUndefined } from "./utils.js";

export async function getDbConfig(): Promise<RuntimeConfig> {
	const row = await db("settings").select("settings_json").first();
	if (!row || !row.settings_json) {
		throw new Error(
			"No configuration found in database. Please save a configuration first.",
		);
	}
	const overrides = JSON.parse(row.settings_json);
	return applyDefaults(overrides);
}

export async function setDbConfig(config: RuntimeConfig): Promise<void> {
	const overrides = stripDefaults(config);
	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		if (existingRow) {
			await trx("settings").update({
				settings_json: JSON.stringify(overrides),
			});
		} else {
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(overrides),
			});
		}
	});
}

export async function updateDbConfig(
	partialConfig: Partial<RuntimeConfig>,
): Promise<void> {
	const sanitizedPartial = omitUndefined(
		partialConfig,
	) as Partial<RuntimeConfig>;
	await db.transaction(async (trx) => {
		const existingRow = await trx("settings").first();
		if (existingRow) {
			const currentConfig = existingRow.settings_json
				? applyDefaults(JSON.parse(existingRow.settings_json))
				: applyDefaults();
			const updatedConfig = applyDefaults({
				...currentConfig,
				...sanitizedPartial,
			});
			await trx("settings").update({
				settings_json: JSON.stringify(stripDefaults(updatedConfig)),
			});
		} else {
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(stripDefaults(sanitizedPartial)),
			});
		}
	});
}
