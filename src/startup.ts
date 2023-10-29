import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { VALIDATION_SCHEMA } from "./zod.js";

export async function doStartupValidation(): Promise<void> {
	logger.info("Validating your configuration...");
	try {
		VALIDATION_SCHEMA.parse(getRuntimeConfig());
	} catch (error) {
		throw new CrossSeedError(error);
	}
	logger.info("Your configuration is valid!");
}
