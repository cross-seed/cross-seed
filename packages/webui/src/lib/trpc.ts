import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../src/trpc/routers';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

// Helper to get the base URL for the API
export function getBaseUrl() {
  if (typeof window !== 'undefined') return ''; // browser should use relative url
  return `http://localhost:${process.env.PORT ?? 2468}`; // dev SSR should use localhost
}

// Create the tRPC React client
export const trpc = createTRPCReact<AppRouter>();

// Configure the client
export const trpcClientConfig = {
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
};
