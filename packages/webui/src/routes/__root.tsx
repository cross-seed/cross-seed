import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from '@/components/Header/Header';

// nothing in  router context right now
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RouterContext {}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
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
        <TanStackRouterDevtools position="bottom-left" />
      )}
    </div>
  ),
});
