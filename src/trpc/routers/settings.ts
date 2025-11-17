import { authedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig, setRuntimeConfig } from "../../runtimeConfig.js";
import { getApiKey } from "../../auth.js";
import { z } from "zod";
import {
	getFileConfig,
	mergeConfig,
	writeConfig,
} from "../../configuration.js";
import {
	getDbConfig,
	isDbConfigEnabled,
	updateDbConfig,
} from "../../dbConfig.js";

export const settingsRouter = router({
	get: authedProcedure.query(async () => {
		try {
			const dbConfigEnabled = isDbConfigEnabled();
			let runtimeConfig;
			if (dbConfigEnabled) {
				runtimeConfig = await getDbConfig();
			} else {
				runtimeConfig = getRuntimeConfig();
			}
			const apikey = await getApiKey();
			return {
				config: runtimeConfig,
				apikey,
				isDbConfig: dbConfigEnabled,
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

				// Update in-memory config with the merged result
				const updatedOverrides = await getDbConfig();
				setRuntimeConfig({
					...getDefaultRuntimeConfig(),
					...(updatedOverrides ?? {}),
				});

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
				await setDbConfig(input as unknown as RuntimeConfig);

				// Update in-memory config so changes are visible immediately
				const sanitizedInput = omitUndefined(
					input as unknown as Partial<RuntimeConfig>,
				) as Partial<RuntimeConfig>;
				setRuntimeConfig({
					...getDefaultRuntimeConfig(),
					...sanitizedInput,
				});

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
