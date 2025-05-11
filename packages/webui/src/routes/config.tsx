import { createRoute } from '@tanstack/react-router';
import { Config } from '@/pages/Config/Config';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/config',
  component: Config,
});