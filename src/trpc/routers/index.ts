import { router } from "../index.js";
import { authRouter } from "./auth.js";
import { configRouter } from "./config.js";
import { logsRouter } from "./logs.js";
import { healthRouter } from "./health.js";

// Main app router
export const appRouter = router({
	auth: authRouter,
	config: configRouter,
	logs: logsRouter,
	health: healthRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
