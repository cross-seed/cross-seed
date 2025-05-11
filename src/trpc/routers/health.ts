import { publicProcedure, router } from "../index.js";

export const healthRouter = router({
	healthcheck: publicProcedure.query(async () => {
		return {
			status: "OK",
			timestamp: new Date().toISOString(),
		};
	}),
});
