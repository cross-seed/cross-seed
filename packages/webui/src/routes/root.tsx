import { Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import Header from '../components/Header/Header';

export function Root() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 pt-5 dark:bg-slate-900">
      <Header />
      <Outlet />
      <TanStackRouterDevtools />
    </div>
  );
}
