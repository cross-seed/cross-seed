import { router } from "../index.js";
import { authRouter } from "./auth.js";
import { configRouter } from "./config.js";
import { logsRouter } from "./logs.js";
import { jobsRouter } from "./jobs.js";
import { statsRouter } from "./stats.js";

// Main app router
export const appRouter = router({
	auth: authRouter,
	config: configRouter,
	logs: logsRouter,
	jobs: jobsRouter,
	stats: statsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
