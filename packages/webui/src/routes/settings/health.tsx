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
import { Page } from '@/components/Page';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

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
    data: { problems },
    refetch,
    isFetching,
  } = useSuspenseQuery(trpc.health.get.queryOptions());

  const sortedProblems = [...problems].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  return (
    <Page
      breadcrumbs={['Settings', 'Health']}
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
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/settings/health')({
  component: HealthPage,
});
