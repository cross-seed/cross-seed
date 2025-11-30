import { router } from "../index.js";
import { authRouter } from "./auth.js";
import { settingsRouter } from "./settings.js";
import { logsRouter } from "./logs.js";
import { jobsRouter } from "./jobs.js";
import { statsRouter } from "./stats.js";
import { indexersRouter } from "./indexers.js";
import { healthRouter } from "./health.js";
import { searcheesRouter } from "./searchees.js";
import { clientsRouter } from "./clients.js";

// Main app router
export const appRouter = router({
	auth: authRouter,
	settings: settingsRouter,
	logs: logsRouter,
	jobs: jobsRouter,
	stats: statsRouter,
	indexers: indexersRouter,
	health: healthRouter,
	searchees: searcheesRouter,
	clients: clientsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
