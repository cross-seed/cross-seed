import { getDefaultRuntimeConfig, stripDefaults } from "./configuration.js";
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
	if (row.settings_json == null) return undefined;

	return parseRuntimeConfigOverrides(JSON.parse(row.settings_json));
}

export async function setDbConfig(
	config: Partial<RuntimeConfig>,
): Promise<void> {
	const sanitizedConfig = omitUndefined(config) as Partial<RuntimeConfig>;
	const mergedConfig = {
		...getDefaultRuntimeConfig(),
		...sanitizedConfig,
	};
	const validatedConfig = parseRuntimeConfig(mergedConfig);
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
				existingRow.settings_json == null
					? {}
					: parseRuntimeConfigOverrides(
							JSON.parse(existingRow.settings_json),
						);
			const mergedConfig = {
				...getDefaultRuntimeConfig(),
				...currentOverrides,
				...sanitizedPartial,
			};
			const validatedConfig = parseRuntimeConfig(mergedConfig);
			await trx("settings").update({
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		} else {
			const mergedConfig = {
				...getDefaultRuntimeConfig(),
				...sanitizedPartial,
			};
			const validatedConfig = parseRuntimeConfig(mergedConfig);
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		}
	});
}
