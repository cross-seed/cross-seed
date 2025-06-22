import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRouteWithContext,
  Outlet,
  useMatches,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { PageLayout } from '@/components/PageLayout';

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
  const matches = useMatches();
  const currentRoute = matches[matches.length - 1];
  const hasCustomLayout = currentRoute?.route?.options?.meta?.customLayout;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <Suspense fallback={<div>Loading...</div>}>
        <Login>
          {hasCustomLayout ? (
            <Outlet />
          ) : (
            <PageLayout>
              <Outlet />
            </PageLayout>
          )}
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
