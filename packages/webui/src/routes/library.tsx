import { createFileRoute } from '@tanstack/react-router';
import { useTRPC } from '@/lib/trpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/time';
import { Page } from '@/components/Page';

export const Route = createFileRoute('/library')({
  component: LibraryPage,
});

function LibraryPage() {
  const trpc = useTRPC();

  const { data } = useSuspenseQuery(
    trpc.searchees.list.queryOptions({
      limit: 100,
    }),
  );

  const configuredIndexers = data.indexerTotals?.configured ?? 0;

  const formatTimestamp = (value: string | null) =>
    value ? formatRelativeTime(value) : 'Never';

  return (
    <Page>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Items</h1>
          <p className="text-muted-foreground text-sm">
            Showing {data.items.length} of {data.total} items
          </p>
          <p className="text-muted-foreground text-xs">
            Indexers: {configuredIndexers} configured
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow className="border-b">
              <TableHead>Name</TableHead>
              <TableHead>Indexers Searched</TableHead>
              <TableHead>First Searched</TableHead>
              <TableHead>Last Searched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-6"
                >
                  No items indexed yet.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((searchee) => (
                <TableRow key={searchee.id}>
                  <TableCell className="font-medium">{searchee.name}</TableCell>
                  <TableCell>{searchee.indexerCount}</TableCell>
                  <TableCell>
                    {formatTimestamp(searchee.firstSearchedAt)}
                  </TableCell>
                  <TableCell>
                    {formatTimestamp(searchee.lastSearchedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}
