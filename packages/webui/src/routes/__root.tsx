import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

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

function RootRoute() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <Suspense fallback={<LoadingSpinner size="lg" />}>
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
              <Outlet />
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
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,
});
