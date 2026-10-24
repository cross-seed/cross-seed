import { authedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig, setRuntimeConfig } from "../../runtimeConfig.js";
import { apiKeySchema, getApiKey, resetApiKey, setApiKey } from "../../auth.js";
import { z } from "zod";
import { getDbConfig, setDbConfig, updateDbConfig } from "../../dbConfig.js";
import { getDefaultRuntimeConfig } from "../../configuration.js";
import { omitUndefined } from "../../utils/object.js";
import { parseRuntimeConfig } from "../../configSchema.js";
import { sendTestNotification } from "../../pushNotifier.js";
import { reloadDownloadClients } from "../../clients/TorrentClient.js";
import { errorMessage } from "../../utils.js";
import { indexTorrentsAndDataDirs } from "../../torrent.js";
import type { RuntimeConfig } from "../../runtimeConfig.js";

function arrayContentsChanged(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return true;
	return a.some((value, index) => value !== b[index]);
}

function torrentSourceConfigChanged(
	before: RuntimeConfig,
	after: RuntimeConfig,
): boolean {
	return (
		before.useClientTorrents !== after.useClientTorrents ||
		before.torrentDir !== after.torrentDir ||
		before.maxDataDepth !== after.maxDataDepth ||
		before.seasonFromEpisodes !== after.seasonFromEpisodes ||
		arrayContentsChanged(
			before.torrentClients ?? [],
			after.torrentClients ?? [],
		) ||
		arrayContentsChanged(before.dataDirs ?? [], after.dataDirs ?? [])
	);
}

function triggerLibraryIndexing(): void {
	void indexTorrentsAndDataDirs({ startup: true }).catch((error) => {
		logger.error({
			label: Label.INDEX,
			message: `Failed to index library after source config update: ${errorMessage(error)}`,
		});
		logger.debug(error);
	});
}

export const settingsRouter = router({
	get: authedProcedure.query(async () => {
		try {
			const runtimeOverrides = await getDbConfig();
			const runtimeConfig = {
				...getDefaultRuntimeConfig(),
				...runtimeOverrides,
			};
			const apiKey = await getApiKey();
			return {
				config: runtimeConfig,
				apiKey,
			};
		} catch (error) {
			logger.error({ label: Label.SERVER, message: errorMessage(error) });
			throw new Error(`Failed to read config: ${errorMessage(error)}`);
		}
	}),

	// We'll need to implement the save functionality
	save: authedProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input }) => {
			try {
				logger.info({
					label: Label.SERVER,
					message: `Saving config updates...`,
				});
				const previousConfig = getRuntimeConfig();

				// Save to database
				await updateDbConfig(input);

				// Update in-memory config with the merged result
				const updatedOverrides = await getDbConfig();
				const updatedConfig = {
					...getDefaultRuntimeConfig(),
					...updatedOverrides,
				};
				setRuntimeConfig(updatedConfig);

				// Keep in-process torrent clients in sync with updated settings.
				reloadDownloadClients();
				if (torrentSourceConfigChanged(previousConfig, updatedConfig)) {
					triggerLibraryIndexing();
				}

				return { success: true };
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: errorMessage(error),
				});
				throw new Error(
					`Failed to save config: ${errorMessage(error)}`,
				);
			}
		}),

	setApiKey: authedProcedure
		.input(z.object({ apiKey: apiKeySchema }))
		.mutation(async ({ input }) => {
			try {
				const apiKey = await setApiKey(input.apiKey);
				setRuntimeConfig({ ...getRuntimeConfig(), apiKey });
				return { apiKey };
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: errorMessage(error),
				});
				throw new Error(
					`Failed to save API key: ${errorMessage(error)}`,
				);
			}
		}),

	resetApiKey: authedProcedure.mutation(async () => {
		try {
			const apiKey = await resetApiKey();
			setRuntimeConfig({ ...getRuntimeConfig(), apiKey });
			return { apiKey };
		} catch (error) {
			logger.error({ label: Label.SERVER, message: errorMessage(error) });
			throw new Error(`Failed to reset API key: ${errorMessage(error)}`);
		}
	}),

	// Full replacement for debug page
	replace: authedProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input }) => {
			try {
				logger.info({
					label: Label.SERVER,
					message: `Replacing full config...`,
				});
				const previousConfig = getRuntimeConfig();

				const parsedConfig = parseRuntimeConfig(
					input satisfies Record<string, unknown>,
				);
				await setDbConfig(parsedConfig);

				// Update in-memory config so changes are visible immediately
				const sanitizedInput = omitUndefined(parsedConfig);
				const updatedConfig = {
					...getDefaultRuntimeConfig(),
					...sanitizedInput,
				};
				setRuntimeConfig(updatedConfig);
				reloadDownloadClients();
				if (torrentSourceConfigChanged(previousConfig, updatedConfig)) {
					triggerLibraryIndexing();
				}

				return { success: true };
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: errorMessage(error),
				});
				throw new Error(
					`Failed to replace config: ${errorMessage(error)}`,
				);
			}
		}),

	validate: authedProcedure.query(() => {
		try {
			// This is a placeholder for config validation
			// We need to implement proper validation logic
			return {
				status: "success",
				validations: { paths: true, torznab: true },
			};
		} catch (error) {
			logger.error({ label: Label.SERVER, message: errorMessage(error) });
			throw new Error(
				`Failed to validate config: ${errorMessage(error)}`,
			);
		}
	}),

	testNotification: authedProcedure
		.input(
			z.object({
				webhooks: z.array(
					z.union([
						z.string(),
						z.object({
							url: z.string().url(),
							payload: z
								.record(z.string(), z.unknown())
								.optional(),
							headers: z
								.record(z.string(), z.string())
								.optional(),
						}),
					]),
				),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const results = await sendTestNotification(input.webhooks);
				return { results };
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: errorMessage(error),
				});
				throw new Error(
					`Failed to send test notification: ${errorMessage(error)}`,
				);
			}
		}),
});
