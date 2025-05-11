import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getContext } from '@/lib/trpc-setup';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

// Create and export the router instance
export const router = createRouter({
  routeTree,
  context: getContext(),
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
