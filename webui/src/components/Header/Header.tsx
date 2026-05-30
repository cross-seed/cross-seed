import { useLocation } from '@tanstack/react-router';
import { ModeToggle } from '@/components/ModeToggle/ModeToggle';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

const getPageTitle = (pathname: string): string => {
  switch (pathname) {
    case '/':
      return 'Dashboard';
    case '/logs':
      return 'Logs';
    case '/jobs':
      return 'Jobs';
    case '/search':
      return 'Search';
    case '/settings':
    case '/settings/general':
      return 'Settings';
    default:
      return 'cross-seed';
  }
};

const Header = () => {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h1 className="text-base font-medium">{pageTitle}</h1>
      <div className="ml-auto">
        <ModeToggle />
      </div>
    </header>
  );
};

export default Header;
