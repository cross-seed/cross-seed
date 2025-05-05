import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { trpc } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { formatDistanceToNow } from 'date-fns';

export function HealthCheck() {
  const Healthcheck = trpc.healthcheck.useQuery();

  if (Healthcheck.isLoading) return <div>Loading...</div>;
  if (Healthcheck.isError) return <div>Error: {Healthcheck.error.message}</div>;

  return (
    <div className="main">
      <section className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold">Analytics</h1>
        <div className="flex w-full list-none gap-16">
          <div className="flex w-1/3 flex-col justify-between">
            <h3 className="mb-2 text-lg font-semibold">Matches</h3>
            <p>List of "match" stats/analytics</p>
          </div>
          <div className="flex w-1/3 flex-col justify-between">
            <h3 className="mb-2 text-lg font-semibold">Matches by tracker</h3>
            <p>Top 10 list of trackers with their matches</p>
          </div>
          <div className="flex w-1/3 flex-col justify-between">
            <h3 className="mb-2 text-lg font-semibold">Most matched file</h3>
            <p>List of the most matched files</p>
          </div>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-xl font-semibold">Health Check</h2>
        <p>
          Status:{' '}
          <span
            className={cn('font-medium', {
              'text-green-500': Healthcheck.data?.status.toLowerCase() === 'ok',
              'text-red-500':
                Healthcheck.data?.status.toLowerCase() === 'error',
            })}
          >
            {Healthcheck.data?.status ?? 'unknown'}
          </span>
        </p>
        <p>
          Last check:{' '}
          <span className="">
            {formatDistanceToNow(Healthcheck.data?.timestamp) ?? 'unknown'}
          </span>
        </p>
      </section>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />
    </div>
  );
}
