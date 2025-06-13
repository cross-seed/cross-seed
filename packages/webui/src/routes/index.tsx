import { createFileRoute } from '@tanstack/react-router';
import { useTRPC } from '@/lib/trpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';

function Home() {
  const trpc = useTRPC();
  const { data: statsData } = useSuspenseQuery(
    trpc.stats.getOverview.queryOptions(),
  );
  const { data: indexerData } = useSuspenseQuery(
    trpc.stats.getIndexerStats.queryOptions(),
  );

  return (
    <div className="main space-y-8">
      <section className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Searchees"
            value={statsData.totalSearchees.toLocaleString()}
            description="Torrents being monitored"
          />
          <StatCard
            title="Total Matches"
            value={statsData.totalMatches.toLocaleString()}
            description="Cross-seeds found"
          />
          <StatCard
            title="Match Rate"
            value={statsData.matchRate.toFixed(2)}
            description="Avg matches per searchee"
          />
          <StatCard
            title="Matches per Snatch"
            value={`${(statsData.matchesPerSnatch * 100).toFixed(1)}%`}
            description="Download success rate"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            title="Active Indexers"
            value={`${statsData.activeIndexers}/${statsData.totalIndexers}`}
            description="Indexers currently enabled"
          />
          <StatCard
            title="Recent Activity"
            value={statsData.recentMatches.toLocaleString()}
            description="Matches in last 24h"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Indexer Status</h2>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {indexerData.map((indexer) => (
            <div
              key={indexer.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <span className="font-medium">{indexer.name}</span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={indexer.active ? 'default' : 'secondary'}
                  className={
                    indexer.active ? 'bg-green-500 hover:bg-green-600' : ''
                  }
                >
                  {indexer.active ? 'Active' : 'Inactive'}
                </Badge>
                {indexer.status && indexer.status !== 'unknown' && (
                  <Badge variant="outline" className="text-xs">
                    {indexer.status}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Home,
});
