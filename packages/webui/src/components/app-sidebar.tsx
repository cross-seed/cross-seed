import * as React from 'react';
import { Link } from '@tanstack/react-router';
import Logo from '@/assets/cross-seed.svg';
import {
  useMutation,
  useSuspenseQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  LogOut,
  Home,
  Settings,
  Search,
  Database,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useTRPC } from '@/lib/trpc';

const navItems = [
  {
    title: 'Main',
    items: [
      {
        title: 'Dashboard',
        icon: <Home className="size-4" />,
        url: '/',
      },
      {
        title: 'Search',
        icon: <Search className="size-4" />,
        url: '/search',
      },
    ],
  },
  {
    title: 'Management',
    items: [
      {
        title: 'Torrents',
        icon: <Database className="size-4" />,
        url: '/torrents',
      },
      {
        title: 'Jobs',
        icon: <RefreshCw className="size-4" />,
        url: '/jobs',
      },
    ],
  },
  {
    title: 'Configuration',
    items: [
      {
        title: 'Settings',
        icon: <Settings className="size-4" />,
        url: '/config',
      },
    ],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { data: authStatus } = useSuspenseQuery(
    trpc.auth.authStatus.queryOptions(),
  );

  const { mutate: logout } = useMutation(
    trpc.auth.logOut.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.auth.authStatus.queryKey(),
        });
      },
    }),
  );

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader className="relative flex px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <img
            src={Logo}
            className="mt-1 h-4 w-4"
            role="presentation"
            alt="cross-seed logo"
          />
          <span className="text-xl font-bold">cross-seed</span>
          <SidebarTrigger className="absolute -right-12 text-neutral-400" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navItems.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <Link to={item.url} activeProps={{ 'data-active': true }}>
                        {item.icon}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        {authStatus?.isLoggedIn && (
          <div className="flex items-center justify-between py-2">
            <div className="text-sm font-medium">
              {authStatus.user?.username}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => logout()}
              title="Logout"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
