import { createRoute } from '@tanstack/react-router';
import { HealthCheck } from '@/pages/Home/Home';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  component: HealthCheck,
});