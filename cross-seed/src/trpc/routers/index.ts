import { settingsApiRouter } from "../../settingsApi.js";
import { router } from "../index.js";
import { authRouter } from "./auth.js";
import { settingsRouter } from "./settings.js";
import { logsRouter } from "./logs.js";
import { jobsRouter } from "./jobs.js";
import { statsRouter } from "./stats.js";
import { indexersRouter } from "./indexers.js";
import { healthRouter } from "./health.js";
import { clientsRouter } from "./clients.js";
import { metaRouter } from "./meta.js";
import { libraryRouter } from "./library.js";

// Main app router
export const appRouter = router({
	auth: authRouter,
	settings: settingsRouter,
	config: settingsApiRouter,
	logs: logsRouter,
	jobs: jobsRouter,
	stats: statsRouter,
	indexers: indexersRouter,
	health: healthRouter,
	clients: clientsRouter,
	meta: metaRouter,
	library: libraryRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
