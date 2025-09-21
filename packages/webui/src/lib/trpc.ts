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
  // In the browser, use the current window location with base path
  if (typeof window !== 'undefined') {
    const root = window.location.origin + import.meta.env.BASE_URL;
    console.log(root);
    return root.replace(/\/$/, ''); // Remove trailing slash if present
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
