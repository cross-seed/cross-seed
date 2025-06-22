import { useMemo, Fragment, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { ModeToggle } from '@/components/ModeToggle/ModeToggle';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface PageProps {
  breadcrumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ breadcrumbs, actions, children }: PageProps) {
  const location = useLocation();

  // Auto-generate breadcrumbs from URL if not provided
  const autoBreadcrumbs = useMemo(() => {
    if (breadcrumbs) return breadcrumbs;

    const segments = location.pathname.split('/').filter(Boolean);
    return segments.map(
      (segment) => segment.charAt(0).toUpperCase() + segment.slice(1),
    );
  }, [location.pathname, breadcrumbs]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />

        {/* Breadcrumbs */}
        <Breadcrumb>
          <BreadcrumbList>
            {autoBreadcrumbs.map((crumb, i) => (
              <Fragment key={i}>
                <BreadcrumbItem>
                  {i === autoBreadcrumbs.length - 1 ? (
                    <BreadcrumbPage>{crumb}</BreadcrumbPage>
                  ) : (
                    crumb
                  )}
                </BreadcrumbItem>
                {i < autoBreadcrumbs.length - 1 && <BreadcrumbSeparator />}
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header Actions */}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ModeToggle />
        </div>
      </header>

      <div className="flex flex-1 flex-col">
        <div className="@container/main">
          <div className="flex flex-col gap-4 p-4">{children}</div>
        </div>
      </div>
    </>
  );
}
