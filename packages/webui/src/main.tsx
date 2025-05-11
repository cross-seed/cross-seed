import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router, queryClient } from './router';
import { TRPCProvider, trpcClient } from './lib/trpc';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
        {process.env.NODE_ENV !== 'production' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
