import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTRPC } from '@/lib/trpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Page } from '@/components/Page';

function Home() {
  const trpc = useTRPC();
  const { data: statsData } = useSuspenseQuery(
    trpc.stats.getOverview.queryOptions(),
  );
  const { data: indexerData } = useSuspenseQuery(
    trpc.stats.getIndexerStats.queryOptions(),
  );

  const showDistinctQueryCount = useMemo(
    () => statsData.queryCount !== statsData.totalSearchees,
    [statsData.queryCount, statsData.totalSearchees],
  );
  const showMatchesPerQuery = showDistinctQueryCount;
  const topGridCols = showDistinctQueryCount
    ? 'lg:grid-cols-5'
    : 'lg:grid-cols-4';
  const conversionGridCols = showMatchesPerQuery
    ? 'lg:grid-cols-4'
    : 'lg:grid-cols-3';
  const indexerHealthTitle = statsData.allIndexersHealthy
    ? 'Indexer Health'
    : 'Unhealthy Indexers';
  const indexerHealthValue = statsData.allIndexersHealthy
    ? `All ${statsData.totalIndexers.toLocaleString()}`
    : statsData.unhealthyIndexers.toLocaleString();
  const indexerHealthDescription = statsData.allIndexersHealthy
    ? 'Indexers are all reporting healthy'
    : `${statsData.unhealthyIndexers.toLocaleString()} of ${statsData.totalIndexers.toLocaleString()} indexers need attention`;

  return (
    <Page breadcrumbs={['Dashboard']}>
      <div className="main space-y-8">
        <section className="space-y-4">
          <div className={`grid gap-4 md:grid-cols-2 ${topGridCols}`}>
            <StatCard
              title="Total Searchees"
              value={statsData.totalSearchees.toLocaleString()}
              description="Torrents being monitored"
            />
            {showDistinctQueryCount && (
              <StatCard
                title="Total Search Queries"
                value={statsData.queryCount.toLocaleString()}
                description="Distinct estimated searches"
              />
            )}
            <StatCard
              title="Total Query-Indexer Pairs"
              value={statsData.queryIndexerCount.toLocaleString()}
              description="Unique indexer searches"
            />
            <StatCard
              title="Total Snatches"
              value={statsData.snatchCount.toLocaleString()}
              description="Unique infohash attempts"
            />
            <StatCard
              title="Total Matches"
              value={statsData.totalMatches.toLocaleString()}
              description="Unique cross-seeds found"
            />
          </div>
          <div className={`grid gap-4 md:grid-cols-2 ${conversionGridCols}`}>
            <StatCard
              title="Matches per Searchee"
              value={statsData.matchRate.toFixed(2)}
              description="Average matches per monitored torrent"
            />
            {showMatchesPerQuery && (
              <StatCard
                title="Matches per Query"
                value={statsData.matchesPerQuery.toFixed(2)}
                description="Matches per search estimate"
              />
            )}
            <StatCard
              title="Match Rate"
              value={`${(statsData.matchesPerQueryIndexer * 100).toFixed(1)}%`}
              description="of indexer searches find a match"
            />
            <StatCard
              title="Wasted Snatches"
              value={`${(statsData.wastedSnatchRate * 100).toFixed(1)}%`}
              description={`${statsData.wastedSnatchCount.toLocaleString()} snatched but mismatched`}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              title={indexerHealthTitle}
              value={indexerHealthValue}
              description={indexerHealthDescription}
            />
            <StatCard
              title="Recent Activity"
              value={statsData.recentMatches.toLocaleString()}
              description="Matches in last 24h"
            />
          </div>
        </section>
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/')({
  component: Home,
});
