import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from '@/components/Header/Header';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../src/trpc/routers';

// Define router context for TypeScript
interface RouterContext {
  queryClient: QueryClient;
  trpc: TRPCOptionsProxy<AppRouter>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Suspense fallback={<div>Loading...</div>}>
        <Login>
          <SidebarProvider defaultOpen={true}>
            <AppSidebar />
            <SidebarInset>
              <div className="px-4 pt-5">
                <Header />
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Login>
      </Suspense>
      {process.env.NODE_ENV !== 'production' && (
        <TanStackRouterDevtools position="top-left" />
      )}
    </div>
  ),
});