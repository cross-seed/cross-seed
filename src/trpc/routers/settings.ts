import { authedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig } from "../../runtimeConfig.js";
import { getApiKey } from "../../auth.js";
import { z } from "zod";
import { setDbConfig, updateDbConfig } from "../../dbConfig.js";
import { RuntimeConfig } from "../../runtimeConfig.js";

export const settingsRouter = router({
	get: authedProcedure.query(async () => {
		try {
			const runtimeConfig = getRuntimeConfig();
			const apikey = await getApiKey();
			return {
				config: runtimeConfig,
				apikey,
			};
		} catch (error) {
			logger.error({ label: Label.SERVER, message: error.message });
			throw new Error(`Failed to read config: ${error.message}`);
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

				// Save to database
				await updateDbConfig(input);

				return { success: true };
			} catch (error) {
				logger.error({ label: Label.SERVER, message: error.message });
				throw new Error(`Failed to save config: ${error.message}`);
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

				// Full replacement instead of partial update
				await setDbConfig(input as RuntimeConfig);

				return { success: true };
			} catch (error) {
				logger.error({ label: Label.SERVER, message: error.message });
				throw new Error(`Failed to replace config: ${error.message}`);
			}
		}),

	validate: authedProcedure.query(async () => {
		try {
			// This is a placeholder for config validation
			// We need to implement proper validation logic
			return {
				status: "success",
				validations: { paths: true, torznab: true },
			};
		} catch (error) {
			logger.error({ label: Label.SERVER, message: error.message });
			throw new Error(`Failed to validate config: ${error.message}`);
		}
	}),
});
