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
  FileText,
  Clock,
  Download,
  // Workflow,
  Folders,
  Webhook,
  Popcorn,
  Library,
  AlertTriangle,
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
        title: 'Library',
        icon: <Library className="size-4" />,
        url: '/library',
      },
      {
        title: 'Jobs',
        icon: <Clock className="size-4" />,
        url: '/jobs',
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        title: 'General',
        icon: <Settings className="size-4" />,
        url: '/settings/general',
      },
      {
        title: 'Trackers',
        icon: <Popcorn className="size-4" />,
        url: '/settings/trackers',
      },
      {
        title: 'Torrent Clients',
        icon: <Download className="size-4" />,
        url: '/settings/clients',
      },
      {
        title: 'Search & RSS',
        icon: <Search className="size-4" />,
        url: '/settings/search',
      },
      {
        title: 'Connect',
        icon: <Webhook className="size-4" />,
        url: '/settings/connect',
      },
      {
        title: 'Directories',
        icon: <Folders className="size-4" />,
        url: '/settings/directories',
      },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      {
        title: 'Health',
        icon: <AlertTriangle className="size-4" />,
        url: '/settings/health',
      },
      {
        title: 'Logs',
        icon: <FileText className="size-4" />,
        url: '/logs',
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
  const { data: buildInfoResponse } = useSuspenseQuery(
    trpc.meta.getBuildInfo.queryOptions(),
  );
  const buildInfo = buildInfoResponse?.build;
  const buildVersion = buildInfoResponse?.version;
  const buildTag = buildInfo?.tag ?? buildVersion;
  const buildBranch = buildInfo?.branch ?? undefined;
  const shortSha = buildInfo?.commitSha?.slice(0, 7);
  const buildLine = [buildTag, shortSha, buildBranch]
    .filter(Boolean)
    .join(' · ');
  const commitMessage = buildInfo?.message?.split('\n')[0]?.trim();
  const buildDate = (() => {
    if (!buildInfo?.date) return undefined;
    const parsed = new Date(buildInfo.date);
    if (Number.isNaN(parsed.getTime())) return buildInfo.date;
    return parsed.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  })();
  const normalizedTag = buildInfo?.tag?.replace(/^v/i, '') ?? '';
  const isVersionTrackingTag =
    normalizedTag === 'latest' ||
    /^\d+(\.\d+){0,2}([-.][0-9A-Za-z.]+)?$/.test(normalizedTag);
  const formatVersion = (version?: string) => {
    if (!version) return undefined;
    return version.startsWith('v') ? version : `v${version}`;
  };
  const preferCommitInfo =
    authStatus?.isDocker && buildInfo?.tag && !isVersionTrackingTag;
  const commitLine = [shortSha, buildBranch, buildDate]
    .filter(Boolean)
    .join(' · ');
  const hasCommitInfo = Boolean(commitLine || commitMessage);
  const isSourceBuild =
    !authStatus?.isDocker && !buildInfo?.tag && hasCommitInfo;
  const isPublishedNpm =
    !authStatus?.isDocker && !buildInfo?.tag && !hasCommitInfo;
  const versionLabel = formatVersion(buildVersion);
  const primaryLine = preferCommitInfo
    ? commitLine || buildLine || versionLabel || ''
    : isSourceBuild
      ? commitLine || versionLabel || ''
    : isPublishedNpm && versionLabel
      ? `${versionLabel} (npm)`
    : buildLine || versionLabel || '';
  const secondaryLine = preferCommitInfo
    ? versionLabel ?? ''
    : isSourceBuild
      ? versionLabel ?? commitMessage ?? ''
    : commitMessage ?? '';
  const hasBuildInfo = Boolean(primaryLine || secondaryLine);

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
      <SidebarHeader className="relative px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <img
            src={Logo}
            className="mt-1 h-4 w-4"
            role="presentation"
            alt="cross-seed logo"
          />
          <span className="text-xl font-bold">cross-seed</span>
        </div>
        {hasBuildInfo && (
          <div className="text-muted-foreground mt-0.5 space-y-0.5 text-xs">
            {primaryLine && (
              <div
                title={
                  preferCommitInfo || isSourceBuild ? commitMessage : undefined
                }
              >
                {primaryLine}
              </div>
            )}
            {secondaryLine && (
              <div
                className={preferCommitInfo ? 'opacity-70' : 'truncate'}
                title={!preferCommitInfo ? commitMessage : undefined}
              >
                {secondaryLine}
              </div>
            )}
          </div>
        )}
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
                      <Link
                        to={item.url}
                        activeProps={{
                          'data-active': true,
                        }}
                        activeOptions={{ exact: true }}
                      >
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
