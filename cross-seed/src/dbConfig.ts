import { getDefaultRuntimeConfig, stripDefaults } from "./configuration.js";
import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";
import { omitUndefined } from "./utils/object.js";
import {
	parseRuntimeConfig,
	parseRuntimeConfigOverrides,
} from "./configSchema.js";
import { createIndexer } from "./services/indexerService.js";

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
	const sanitizedConfig = omitUndefined(config);
	const mergedConfig = {
		...getDefaultRuntimeConfig(),
		...sanitizedConfig,
	};
	const validatedConfig = parseRuntimeConfig(mergedConfig);
	const overrides = stripDefaults(validatedConfig);
	const indexersToAdd: { url: string; apikey: string }[] = [];
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
		// Also add any torznab links to indexers table
		if (validatedConfig.torznab && Array.isArray(validatedConfig.torznab)) {
			for (const tracker of validatedConfig.torznab) {
				const baseUrl = new URL(tracker);
				const url = `${baseUrl.origin}${baseUrl.pathname}`;
				const apiKey = new URLSearchParams(baseUrl.searchParams).get(
					"apikey",
				);
				const existingIndexer = await trx("indexer").where({
					url: url,
				});
				if (existingIndexer.length === 0) {
					indexersToAdd.push({
						url,
						apikey: apiKey ?? "",
					});
				}
			}
		}
	});

	for (const tracker of indexersToAdd) {
		await createIndexer({
			url: tracker.url,
			apikey: tracker.apikey ?? "",
			enabled: true,
		});
	}
}

export async function updateDbConfig(
	partialConfig: Partial<RuntimeConfig>,
): Promise<void> {
	const sanitizedPartial = omitUndefined(partialConfig);
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
