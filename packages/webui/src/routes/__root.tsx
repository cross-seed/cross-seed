import Header from '@/components/Header/Header.tsx';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

// nothing in  router context right now
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RouterContext {}

function getIsDevtoolsEnabled(): boolean {
  try {
    if (
      process.env.NODE_ENV === 'production' ||
      window.localStorage.getItem('DISABLE_DEVTOOLS') === 'true'
    ) {
      return false;
    }
    return true;
  } catch (e) {
    // localStorage not available, assume devtools are enabled
    return true;
  }
}

const isDevtoolsEnabled = getIsDevtoolsEnabled();

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="bg-background text-foreground min-h-screen">
      <Suspense fallback={<div>Loading...</div>}>
        <Login>
          <SidebarProvider
            defaultOpen={true}
            style={
              {
                '--sidebar-width': 'calc(var(--spacing) * 48)',
                '--header-height': 'calc(var(--spacing) * 12)',
              } as React.CSSProperties
            }
          >
            <AppSidebar />
            <SidebarInset>
              <Header />
              <div className="flex flex-1 flex-col">
                <div className="@container/main">
                  <div className="flex flex-col gap-4 p-4">
                    <Outlet />
                  </div>
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Login>
      </Suspense>
      {isDevtoolsEnabled && (
        <>
          <ReactQueryDevtools initialIsOpen={false} />
          <TanStackRouterDevtools position="bottom-left" />
        </>
      )}
    </div>
  ),
});
