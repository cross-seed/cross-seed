import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { Root } from '@/routes/root';
import { Logs } from '@/features/Logs/Logs';
import { HealthCheck } from '@/pages/Home/Home';
import { Config } from '@/pages/Config/Config';

const rootRoute = createRootRoute({
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

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
