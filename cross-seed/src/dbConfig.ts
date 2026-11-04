import { validateSourceLayout } from "./sourcePaths.js";
import { getDefaultRuntimeConfig, stripDefaults } from "./configuration.js";
import { db } from "./db.js";
import { RuntimeConfig } from "./runtimeConfig.js";
import { omitUndefined } from "./utils/object.js";
import {
	parseRuntimeConfig,
	parseRuntimeConfigOverrides,
} from "./configSchema.js";
import { insertIndexer } from "./services/indexerService.js";
import type { Indexer } from "./indexers.js";
import { updateCapsForIndexer } from "./torznab.js";

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
	await validateSourceLayout(validatedConfig);
	const overrides = stripDefaults(validatedConfig);
	const importedIndexers = new Map(
		validatedConfig.torznab.map((tracker) => {
			const baseUrl = new URL(tracker);
			return [
				`${baseUrl.origin}${baseUrl.pathname}`,
				baseUrl.searchParams.get("apikey") ?? "",
			];
		}),
	);
	const addedIndexers: Indexer[] = [];
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
		// Persist the whole import atomically. A failed indexer write must leave
		// startup able to retry the file rather than accepting partial settings.
		for (const [url, apiKey] of importedIndexers) {
			const existingIndexer = await trx("indexer").where({ url }).first();
			if (existingIndexer) {
				// Preserve IDs, history, capabilities and enabled state. Only the
				// credential supplied by the imported URL is authoritative here.
				await trx("indexer")
					.where({ url })
					.update({ apikey: apiKey ?? "" });
			} else {
				addedIndexers.push(
					await insertIndexer(
						{ url, apikey: apiKey ?? "", enabled: true },
						trx,
					),
				);
			}
		}
	});

	// Capability discovery is best effort and must never hold the import transaction.
	for (const indexer of addedIndexers) {
		await updateCapsForIndexer(indexer);
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
			await validateSourceLayout(validatedConfig);
			await trx("settings").update({
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		} else {
			const mergedConfig = {
				...getDefaultRuntimeConfig(),
				...sanitizedPartial,
			};
			const validatedConfig = parseRuntimeConfig(mergedConfig);
			await validateSourceLayout(validatedConfig);
			await trx("settings").insert({
				apikey: null,
				settings_json: JSON.stringify(stripDefaults(validatedConfig)),
			});
		}
	});
}
