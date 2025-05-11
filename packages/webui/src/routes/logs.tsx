import { createRoute } from '@tanstack/react-router';
import { Logs } from '@/features/Logs/Logs';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/logs',
  component: Logs,
});