import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../../src/trpc/routers";
import { AuthWrapper } from "../components/auth/AuthWrapper";

import Header from "../components/Header";

import TanstackQueryLayout from "../integrations/tanstack-query/layout";

import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
	trpc: TRPCOptionsProxy<AppRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Cross-Seed",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	component: () => (
		<>
			<Header />
			<AuthWrapper>
				<Outlet />
			</AuthWrapper>
			{process.env.NODE_ENV !== "production" && (
				<TanStackRouterDevtools />
			)}
			<TanstackQueryLayout />
		</>
	),
});
