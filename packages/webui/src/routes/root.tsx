import { Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Suspense } from 'react';
import { Login } from '@/components/auth/AuthWrapper';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from '@/components/Header/Header';

export function Root() {
  return (
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
      <TanStackRouterDevtools position="top-left" />
    </div>
  );
}