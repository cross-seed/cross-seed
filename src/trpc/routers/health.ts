import { authedProcedure, router } from "../index.js";
import { collectProblems } from "../../problems.js";
import { Label, logger } from "../../logger.js";

export const healthRouter = router({
	get: authedProcedure.query(async () => {
		try {
			const problems = await collectProblems();
			return { problems };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error ?? "");
			logger.error({
				label: Label.SERVER,
				message: `Failed to collect health information: ${message}`,
			});
			throw new Error(`Failed to collect health information: ${message}`);
		}
	}),
});
