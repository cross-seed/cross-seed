import { authedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";

export const healthRouter = router({
	check: authedProcedure.query(async () => {
		try {
			// Return basic health status
			return {
				status: "OK",
				timestamp: new Date().toISOString(),
				version: process.env.npm_package_version || "unknown",
			};
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Failed health check: ${error.message}`,
			});

			return {
				status: "ERROR",
				timestamp: new Date().toISOString(),
				error: error.message,
			};
		}
	}),
});
