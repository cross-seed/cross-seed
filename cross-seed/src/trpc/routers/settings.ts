import { TRPCError } from "@trpc/server";
import { validSettingsCliToken } from "../../configDaemonDiscovery.js";
import { authedProcedure, unauthedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig, setRuntimeConfig } from "../../runtimeConfig.js";
import { apiKeySchema, getApiKey, resetApiKey, setApiKey } from "../../auth.js";
import { z } from "zod";
import { daemonSettingsService } from "../../daemonSettings.js";
import { sendTestNotification } from "../../pushNotifier.js";
import { errorMessage } from "../../utils.js";
import type { RuntimeConfig } from "../../runtimeConfig.js";

// The filesystem capability grants settings access only; ordinary tRPC
// authentication and all other procedures remain unchanged.
const cliSettingsProcedure = unauthedProcedure.use(({ ctx, next }) => {
	const localCli = validSettingsCliToken(
		ctx.req?.headers.get("authorization") ?? undefined,
	);
	if (!ctx.user && !localCli) throw new TRPCError({ code: "UNAUTHORIZED" });
	return next({ ctx: { ...ctx, localCli } });
});

export const settingsRouter = router({
	get: cliSettingsProcedure.query(async () => ({
		config: (await daemonSettingsService.read(true)) as RuntimeConfig,
		apiKey: await getApiKey(),
	})),

	save: cliSettingsProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input }) => {
			await daemonSettingsService.patch(input);
			return { success: true };
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

	replace: cliSettingsProcedure
		.input(z.object({}).passthrough())
		.mutation(async ({ input }) => {
			await daemonSettingsService.replace(input);
			return { success: true };
		}),

	unset: cliSettingsProcedure
		.input(z.object({ key: z.string() }).strict())
		.mutation(async ({ input }) => {
			await daemonSettingsService.unset(input.key);
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
