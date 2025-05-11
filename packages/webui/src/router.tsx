import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { Root } from '@/routes/root';
import { Logs } from '@/features/Logs/Logs';
import { HealthCheck } from '@/pages/Home/Home';
import { Config } from '@/pages/Config/Config';
import { trpc } from '@/lib/trpc';

// Create a QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// Create routes with context
interface RouterContext {
  queryClient: QueryClient;
  trpc: typeof trpc;
}

const rootRoute = createRootRoute<RouterContext>({
  component: Root,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HealthCheck,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'logs',
  component: Logs,
});

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'config',
  component: Config,
});

const routeTree = rootRoute.addChildren([homeRoute, logsRoute, configRoute]);

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
    trpc,
  },
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
