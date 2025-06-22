import React from 'react';
import { useLocation } from '@tanstack/react-router';
import { ModeToggle } from '@/components/ModeToggle/ModeToggle';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface PageProps {
  breadcrumbs?: string[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function Page({ breadcrumbs, actions, children }: PageProps) {
  const location = useLocation();
  
  // Auto-generate breadcrumbs from URL if not provided
  const autoBreadcrumbs = React.useMemo(() => {
    if (breadcrumbs) return breadcrumbs;
    
    const segments = location.pathname.split('/').filter(Boolean);
    return segments.map(segment => 
      segment.charAt(0).toUpperCase() + segment.slice(1)
    );
  }, [location.pathname, breadcrumbs]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2">
          {autoBreadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-muted-foreground">&gt;</span>}
              <span className={i === autoBreadcrumbs.length - 1 ? "text-base font-medium" : "text-base text-muted-foreground"}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </div>
        
        {/* Header Actions */}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ModeToggle />
        </div>
      </header>
      
      <div className="flex flex-1 flex-col">
        <div className="@container/main">
          <div className="flex flex-col gap-4 p-4">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}