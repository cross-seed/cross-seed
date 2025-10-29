import { publicProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getRuntimeConfig } from "../../runtimeConfig.js";
import { getApiKey } from "../../auth.js";
import { z } from "zod";

export const configRouter = router({
	get: publicProcedure.query(async () => {
		try {
			const runtimeConfig = getRuntimeConfig();
			const apikey = await getApiKey();
			return {
				config: runtimeConfig,
				apikey,
			};
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: error.message,
			});
			throw new Error(`Failed to read config: ${error.message}`);
		}
	}),

	// We'll need to implement the save functionality
	save: publicProcedure
		.input(z.object({}).passthrough())
		.mutation(async () => {
			try {
				// This is a placeholder for now
				// We need to implement proper config saving functionality
				logger.info({
					label: Label.SERVER,
					message: "Config save requested",
				});

				// Return success for now
				return { success: true };
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: error.message,
				});
				throw new Error(`Failed to save config: ${error.message}`);
			}
		}),

	validate: publicProcedure.query(async () => {
		try {
			// This is a placeholder for config validation
			// We need to implement proper validation logic
			return {
				status: "success",
				validations: {
					paths: true,
					torznab: true,
				},
			};
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: error.message,
			});
			throw new Error(`Failed to validate config: ${error.message}`);
		}
	}),
});
