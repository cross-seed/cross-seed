import { createRouter as createTanstackRouter } from "@tanstack/react-router";
import * as TanstackQuery from "./integrations/tanstack-query/root-provider";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

import "./styles.css";

// Create a new router instance
export const createRouter = () => {
	const router = createTanstackRouter({
		routeTree,
		context: {
			...TanstackQuery.getContext(),
		},
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		Wrap: (props: { children: React.ReactNode }) => {
			return (
				<TanstackQuery.Provider>{props.children}</TanstackQuery.Provider>
			);
		},
	});

	return router;
};

// Register the router instance for type safety
declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createRouter>;
	}
}
