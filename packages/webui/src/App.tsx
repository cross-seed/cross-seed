import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { httpBatchLink } from '@trpc/client';
import './App.css';
import { RouterProvider } from '@tanstack/react-router';
import { router } from '@/router';
import { ThemeProvider } from '@/contexts/Theme/ThemeProvider';

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: 'http://192.168.1.234:4000/api',
          fetch(url, options) {
            // console.log('making request to: ', url, options);
            return fetch(url, {
              ...options,
              // credentials: 'include',
            });
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="xseed-ui-theme">
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default App;
