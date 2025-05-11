import { promises as fs } from "fs";
import { join } from "path";
import { publicProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";

export const logsRouter = router({
	getVerbose: publicProcedure.query(async () => {
		try {
			// Get the logs directory from the current working directory
			const logPath = join(process.cwd(), "logs/verbose.current.log");
			const logData = await fs.readFile(logPath, "utf-8");
			return logData;
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Failed to read verbose logs: ${error.message}`,
			});
			throw new Error(`Failed to read verbose logs: ${error.message}`);
		}
	}),
});
