import { useTRPC } from '@/lib/trpc';
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Play, Check } from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { Page } from '@/components/Page';

export const Route = createFileRoute('/jobs')({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const [triggeredJobs, setTriggeredJobs] = useState<Set<string>>(new Set());

  const { data: jobs } = useSuspenseQuery(
    trpc.jobs.getJobStatuses.queryOptions(undefined, {
      refetchInterval: 5000,
    }),
  );

  const { mutate: triggerJob } = useMutation(
    trpc.jobs.triggerJob.mutationOptions({
      onSuccess: (_data, { name: jobName }) => {
        setTriggeredJobs((prev) => new Set(prev).add(jobName));
        // Clear the checkmark after 3 seconds
        setTimeout(() => {
          setTriggeredJobs((prev) => {
            const updated = new Set(prev);
            updated.delete(jobName);
            return updated;
          });
        }, 3000);
      },
      onError: (error) => {
        console.error('Failed to trigger job:', error.message);
      },
    }),
  );

  const getStatusBadge = (job: Job) => {
    if (job.isActive) {
      return (
        <Badge variant="default" className="bg-blue-500">
          Running
        </Badge>
      );
    }
    if (job.nextExecution === 'now') {
      return <Badge variant="secondary">Ready</Badge>;
    }
    return <Badge variant="outline">Scheduled</Badge>;
  };

  const formatJobName = (name: string) => {
    return name
      .split(/(?=[A-Z])/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Page>
      <div className="rounded-md border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Interval</TableHead>
            <TableHead>Last Execution</TableHead>
            <TableHead>Next Execution</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs?.map((job) => (
            <TableRow key={job.name}>
              <TableCell className="font-medium">
                {formatJobName(job.name)}
              </TableCell>
              <TableCell>{job.interval}</TableCell>
              <TableCell>
                {job.lastExecution
                  ? formatRelativeTime(job.lastExecution)
                  : 'Never'}
              </TableCell>
              <TableCell>
                {job.nextExecution === 'now'
                  ? 'Now'
                  : formatRelativeTime(job.nextExecution)}
              </TableCell>
              <TableCell>{getStatusBadge(job)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={job.isActive || !job.canRunNow}
                  onClick={() => triggerJob({ name: job.name })}
                >
                  {triggeredJobs.has(job.name) ? (
                    <>
                      <Check className="mr-1 h-4 w-4 text-green-600" />
                      Started
                    </>
                  ) : (
                    <>
                      <Play className="mr-1 h-4 w-4" />
                      Run
                    </>
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </Page>
  );
}
