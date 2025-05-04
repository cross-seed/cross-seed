import { router } from "../index.js";
import { authRouter } from "./auth.js";

// Main app router
export const appRouter = router({
	auth: authRouter,
	// Add other routers here as needed (e.g., settings, logs, search)
});

// Export type definition of API
export type AppRouter = typeof appRouter;
