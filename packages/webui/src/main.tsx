import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router, queryClient } from './router';
import { trpc, trpcClientConfig } from './lib/trpc';
import { TrpcProvider } from './components/TrpcProvider';

import './index.css';

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
