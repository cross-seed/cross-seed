import { applyDefaults, stripDefaults } from "./configuration.js";
import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";
import { omitUndefined } from "./utils.js";
import {
	parseRuntimeConfig,
	parseRuntimeConfigOverrides,
} from "./configSchema.js";

export async function getDbConfig(): Promise<
	Partial<RuntimeConfig> | undefined
> {
	const row = await db("settings").select("settings_json").first();
	if (!row) return undefined;
	if (row.settings_json === null || row.settings_json === undefined)
		return undefined;
	const overrides =
		typeof row.settings_json === "string"
			? JSON.parse(row.settings_json)
			: row.settings_json;
	return parseRuntimeConfigOverrides(overrides);
}

export async function setDbConfig(
	config: Partial<RuntimeConfig> | RuntimeConfig,
): Promise<void> {
	const validatedConfig = parseRuntimeConfig(applyDefaults(config));
	const overrides = stripDefaults(validatedConfig);
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
			const currentOverrides =
				existingRow.settings_json === null ||
				existingRow.settings_json === undefined
					? {}
					: parseRuntimeConfigOverrides(
							typeof existingRow.settings_json === "string"
								? JSON.parse(existingRow.settings_json)
								: existingRow.settings_json,
						);
			const mergedConfig = applyDefaults({
				...currentOverrides,
				...sanitizedPartial,
			});
			const validatedConfig = parseRuntimeConfig(mergedConfig);
			await trx("settings").update({
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		} else {
			const validatedConfig = parseRuntimeConfig(
				applyDefaults(sanitizedPartial),
			);
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		}
	});
}
