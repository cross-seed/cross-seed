import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { trpc, trpcClientConfig } from './lib/trpc';
import { QueryClient } from '@tanstack/react-query';
import { TrpcProvider } from './components/TrpcProvider';

import './index.css';

// Create a query client with default settings
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
    <trpc.Provider client={trpcClientConfig} queryClient={queryClient}>
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>
    </trpc.Provider>
  </StrictMode>,
)
