import { TRPCError } from "@trpc/server";
import { validSettingsCliToken } from "../../configDaemonDiscovery.js";
import { authedProcedure, unauthedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig, setRuntimeConfig } from "../../runtimeConfig.js";
import { apiKeySchema, getApiKey, resetApiKey, setApiKey } from "../../auth.js";
import { z } from "zod";
import {
	getDbConfig,
	setDbConfig,
	updateDbConfig,
	unsetDbConfig,
} from "../../dbConfig.js";
import { getDefaultRuntimeConfig } from "../../configuration.js";
import { omitUndefined } from "../../utils/object.js";
import {
	parseRuntimeConfig,
	RUNTIME_CONFIG_SCHEMA,
} from "../../configSchema.js";
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

// The filesystem capability grants settings access only; ordinary tRPC
// authentication and all other procedures remain unchanged.
const cliSettingsProcedure = unauthedProcedure.use(({ ctx, next }) => {
	const localCli = validSettingsCliToken(ctx.req?.headers.authorization);
	if (!ctx.user && !localCli) throw new TRPCError({ code: "UNAUTHORIZED" });
	return next({ ctx: { ...ctx, localCli } });
});

async function replaceSettings(
	input: Record<string, unknown>,
): Promise<{ success: boolean }> {
	const previousConfig = getRuntimeConfig();
	const parsedConfig = parseRuntimeConfig(input);
	await setDbConfig(parsedConfig);
	const updatedConfig = {
		...getDefaultRuntimeConfig(),
		...omitUndefined(parsedConfig),
	};
	setRuntimeConfig(updatedConfig);
	reloadDownloadClients();
	if (torrentSourceConfigChanged(previousConfig, updatedConfig))
		triggerLibraryIndexing();
	return { success: true };
}

export const settingsRouter = router({
	get: cliSettingsProcedure.query(async () => {
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
	save: cliSettingsProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input, ctx }) => {
			try {
				logger.info({
					label: Label.SERVER,
					message: `Saving config updates...`,
				});
				const previousConfig = getRuntimeConfig();

				if (ctx.localCli) {
					if (Object.hasOwn(input, "torznab"))
						throw new Error(
							"Manage indexers in Settings → Trackers.",
						);
					RUNTIME_CONFIG_SCHEMA.strict().parse({
						...getDefaultRuntimeConfig(),
						...(await getDbConfig()),
						...input,
					});
				}

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

	// Full replacement for debug page and local CLI imports.
	replace: cliSettingsProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input, ctx }) => {
			if (ctx.localCli) {
				if (Array.isArray(input.torznab) && input.torznab.length)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Manage indexers in Settings → Trackers; legacy torznab URLs cannot be imported.",
					});
				RUNTIME_CONFIG_SCHEMA.strict().parse({
					...getDefaultRuntimeConfig(),
					...input,
				});
			}
			return replaceSettings(input);
		}),

	unset: cliSettingsProcedure
		.input(z.object({ key: z.string() }).strict())
		.mutation(async ({ input }) => {
			if (!Object.hasOwn(RUNTIME_CONFIG_SCHEMA.shape, input.key))
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Unknown setting: ${input.key}`,
				});
			const previousConfig = getRuntimeConfig();
			await unsetDbConfig(input.key);
			const updatedConfig = {
				...getDefaultRuntimeConfig(),
				...(await getDbConfig()),
			};
			setRuntimeConfig(updatedConfig);
			reloadDownloadClients();
			if (torrentSourceConfigChanged(previousConfig, updatedConfig))
				triggerLibraryIndexing();
			return { success: true };
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
