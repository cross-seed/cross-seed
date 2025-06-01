import {
  createTRPCClient,
  httpBatchLink,
  splitLink,
  httpSubscriptionLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../../src/trpc/routers';

// Helper to get the base URL for the API
export function getBaseUrl() {
  // In the browser, use the current window location
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // In development, use localhost
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:2468';
  }

  // Default: assume we're in a production environment
  return '';
}

// Create a tRPC client (for usage outside of React)
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({
        url: `${getBaseUrl()}/api/trpc`,
      }),
      false: httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
      }),
    }),
  ],
});

// Create the tRPC context for React hooks
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
