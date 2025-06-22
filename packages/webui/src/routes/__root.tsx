import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRouteWithContext,
  Outlet,
  useMatches,
  useRouter,
  useLocation,
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
  const router = useRouter();
  const location = useLocation();
  
  // Find route definition in router's route tree
  const findRouteInTree = (tree, pathname) => {
    if (tree.fullPath === pathname) return tree;
    if (tree.children) {
      for (const child of tree.children) {
        const found = findRouteInTree(child, pathname);
        if (found) return found;
      }
    }
    return null;
  };
  
  const targetRoute = findRouteInTree(router.routeTree, location.pathname);
  const hasCustomLayout = targetRoute?.options?.meta?.customLayout || false;

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
