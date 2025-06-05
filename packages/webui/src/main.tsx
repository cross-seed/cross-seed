import { ThemeProvider } from '@/contexts/Theme/ThemeProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { trpcClient, TRPCProvider } from './lib/trpc';
import { router } from './router';

import './index.css';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="cross-seed-ui-theme">
          <RouterProvider router={router} />
        </ThemeProvider>
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
