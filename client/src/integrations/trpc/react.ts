import type { AppRouter } from "../../../../src/trpc/routers";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
