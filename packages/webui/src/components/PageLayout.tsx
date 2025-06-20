import React from 'react';
import { ModeToggle } from '@/components/ModeToggle/ModeToggle';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger, SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';

interface PageLayoutProps {
  breadcrumbs?: string[];
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageLayout({ breadcrumbs, headerActions, children }: PageLayoutProps) {
  return (
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2">
            {breadcrumbs?.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-muted-foreground">&gt;</span>}
                <span className={i === breadcrumbs.length - 1 ? "text-base font-medium" : "text-base text-muted-foreground"}>
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </div>
          
          {/* Header Actions */}
          <div className="ml-auto flex items-center gap-2">
            {headerActions}
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
      </SidebarInset>
    </SidebarProvider>
  );
}