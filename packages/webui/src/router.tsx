import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

// Create a QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// Create and export the router instance
export const router = createRouter({
  routeTree,
  context: {
    queryClient,
    trpc,
  },
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
