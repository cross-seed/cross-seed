import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Page } from '@/components/Page';
import { useTRPC } from '@/lib/trpc';
import { cn, formatBytes } from '@/lib/utils';

const severityOrder = {
  error: 0,
  warning: 1,
  info: 2,
} as const;

const severityStyles = {
  error: 'border-red-500/60 bg-red-500/10',
  warning: 'border-amber-500/60 bg-amber-500/10',
  info: 'border-sky-500/60 bg-sky-500/10',
} as const;

const severityIcon = {
  error: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
} as const;

function HealthPage() {
  const trpc = useTRPC();
  const {
    data: { problems, diagnostics },
    refetch,
    isFetching,
  } = useSuspenseQuery(trpc.health.get.queryOptions());

  const sortedProblems = [...problems].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
  const db = diagnostics?.db;
  const formatCount = (value: number | null | undefined) =>
    value === null || value === undefined ? 'Unknown' : value.toLocaleString();
  const formatPercent = (value: number | null | undefined) =>
    value === null || value === undefined ? 'Unknown' : `${value.toFixed(1)}%`;

  return (
    <Page
      breadcrumbs={['Diagnostics', 'Health']}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn(
              'mr-2 h-4 w-4',
              isFetching && 'text-primary animate-spin',
            )}
          />
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Health</h1>
          <p className="text-muted-foreground text-sm">
            A quick snapshot of anything that needs attention. Issues are
            ordered by severity.
          </p>
        </div>

        {sortedProblems.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <p className="font-medium">All clear</p>
              <p className="text-muted-foreground">
                No health issues detected. Everything looks good.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedProblems.map((problem) => {
              const Icon = severityIcon[problem.severity];
              return (
                <div
                  key={problem.id}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-sm',
                    severityStyles[problem.severity],
                  )}
                >
                  <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">{problem.summary}</p>
                    {problem.details && (
                      <p className="text-muted-foreground">{problem.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Database diagnostics</h2>
            <p className="text-muted-foreground text-sm">
              Disk usage and SQLite stats for your cross-seed database.
            </p>
          </div>

          {!db ? (
            <p className="text-sm text-muted-foreground">
              No database diagnostics available.
            </p>
          ) : (
            <div className="space-y-4">
              {db.error && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700">
                  <p className="font-medium">Diagnostics error</p>
                  <p className="text-muted-foreground">{db.error}</p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">Database file</p>
                  <p className="text-base font-semibold">
                    {formatBytes(db.sizes.db, { binary: true })}
                  </p>
                  <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                    {db.path}
                  </p>
                </div>
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">WAL file</p>
                  <p className="text-base font-semibold">
                    {formatBytes(db.sizes.wal, { binary: true })}
                  </p>
                </div>
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">SHM file</p>
                  <p className="text-base font-semibold">
                    {formatBytes(db.sizes.shm, { binary: true })}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">Page size</p>
                  <p className="text-base font-semibold">
                    {formatBytes(db.pageSize, { binary: true })}
                  </p>
                </div>
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">Page count</p>
                  <p className="text-base font-semibold">
                    {formatCount(db.pageCount)}
                  </p>
                </div>
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground">Freelist pages</p>
                  <p className="text-base font-semibold">
                    {formatCount(db.freelistCount)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {formatBytes(db.freeBytes, { binary: true })} free (
                    {formatPercent(db.freePercent)})
                  </p>
                </div>
              </div>

              {db.dbstatError && (
                <p className="text-sm text-muted-foreground">
                  Table size breakdown unavailable: {db.dbstatError}
                </p>
              )}

              {db.dbstatTop && db.dbstatTop.length > 0 && (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b">
                        <TableHead>Object</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right">Pages</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {db.dbstatTop.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell className="font-medium">
                            {row.name}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatBytes(row.bytes, { binary: true })}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.pages.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/settings/health')({
  component: HealthPage,
});
