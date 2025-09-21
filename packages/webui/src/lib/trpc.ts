import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../../src/trpc/routers';

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');

// Create a tRPC client (for usage outside of React)
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({
        url: `${baseUrl}/api/trpc`,
      }),
      false: httpBatchLink({
        url: `${baseUrl}/api/trpc`,
      }),
    }),
  ],
});

// Create the tRPC context for React hooks
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
