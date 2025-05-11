import { createTRPCClient } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../../src/trpc/routers';

// Helper to get the base URL for the API
export function getBaseUrl() {
  if (typeof window !== 'undefined') return ''; // browser should use relative url
  return `http://localhost:${process.env.PORT ?? 2468}`; // dev SSR should use localhost
}

// Create the tRPC context (this is the recommended approach from docs)
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

// Create a tRPC client (for non-hook usage)
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
