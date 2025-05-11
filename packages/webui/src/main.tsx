import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { ThemeProvider } from '@/contexts/Theme/ThemeProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { TRPCProvider, trpcClient } from './lib/trpc';
import { QueryClient } from '@tanstack/react-query';

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
        <ThemeProvider defaultTheme="system" storageKey="xseed-ui-theme">
          <RouterProvider router={router} />
        </ThemeProvider>
        {process.env.NODE_ENV !== 'production' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>
)
