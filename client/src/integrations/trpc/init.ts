import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../../src/trpc/routers";

// Get the base URL for the API
export const getBaseUrl = () => {
	// In the browser, use the current window location
	if (typeof window !== "undefined") {
		return window.location.origin;
	}

	// In development, use localhost
	if (process.env.NODE_ENV === "development") {
		return "http://localhost:3000";
	}

	// Default: assume we're in a production environment
	return "";
};

// Initialize the tRPC client
export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${getBaseUrl()}/api/trpc`,
			// You can add headers and other options here
		}),
	],
	transformer: superjson,
});
