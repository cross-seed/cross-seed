import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Page } from '@/components/Page';
import { formatRelativeTime } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Search,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/library')({
  component: LibraryPage,
});

function toBoolean(value: boolean | 'indeterminate'): boolean {
  return value === true;
}

const PAGE_SIZE = 25;
const MAX_BULK_SELECTION = 20;

function LibraryPage() {
  const trpc = useTRPC();
  const [page, setPage] = useState(0);
  // TODO: replace title-based map once searchees have stable persisted IDs exposed over TRPC.
  const [selectedItems, setSelectedItems] = useState(
    () => new Map<string, { id: string; name: string }>(),
  );

  const queryInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [page],
  );

  const query = useSuspenseQuery(trpc.searchees.list.queryOptions(queryInput));
  const { data, isFetching } = query;

  useEffect(() => {
    if (page * PAGE_SIZE < data.total) return;
    if (data.total === 0) {
      setPage(0);
      return;
    }
    const newPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
    if (newPage !== page) {
      setPage(newPage);
    }
  }, [data.total, page]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const canGoPrev = page > 0;
  const canGoNext = (page + 1) * PAGE_SIZE < data.total;
  const items = data.items;
  const rangeStart = data.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = data.total === 0 ? 0 : page * PAGE_SIZE + items.length;

  const allSelectedOnPage =
    items.length > 0 && items.every((item) => selectedItems.has(item.id));
  const someSelectedOnPage = items.some((item) => selectedItems.has(item.id));

  const selectedCount = selectedItems.size;

  const toggleSelectAll = (checked: boolean) => {
    setSelectedItems((prev) => {
      const updated = new Map(prev);
      if (checked) {
        items.forEach((item) =>
          updated.set(item.id, { id: item.id, name: item.name }),
        );
      } else {
        items.forEach((item) => updated.delete(item.id));
      }
      return updated;
    });
  };

  const toggleItem = (item: { id: string; name: string }, checked: boolean) => {
    setSelectedItems((prev) => {
      const updated = new Map(prev);
      if (checked) {
        updated.set(item.id, item);
      } else {
        updated.delete(item.id);
      }
      return updated;
    });
  };

  const clearSelection = () => setSelectedItems(new Map());

  const bulkSearchMutation = useMutation(
    trpc.searchees.bulkSearch.mutationOptions({
      onSuccess: (result) => {
        const { attempted, totalFound, skipped } = result;
        if (attempted === 0) {
          toast.info('No eligible items to search', {
            description:
              skipped > 0
                ? `${skipped} item${skipped === 1 ? '' : 's'} were skipped by filters.`
                : undefined,
          });
        } else {
          toast.success('Bulk search complete', {
            description: `${attempted} item${attempted === 1 ? '' : 's'} searched${
              skipped ? ` (${skipped} skipped)` : ''
            }. Found ${totalFound} match${totalFound === 1 ? '' : 'es'}.`,
          });
        }
        clearSelection();
        void query.refetch();
      },
      onError: (error) => {
        toast.error('Bulk search failed', {
          description: error.message,
        });
      },
    }),
  );

  const bulkSearchDisabled =
    selectedCount === 0 ||
    selectedCount > MAX_BULK_SELECTION ||
    bulkSearchMutation.isPending;

  const runBulkSearch = (force: boolean) => {
    if (selectedCount === 0) return;
    if (selectedCount > MAX_BULK_SELECTION) {
      toast.error(
        `Bulk search supports up to ${MAX_BULK_SELECTION} items at a time.`,
      );
      return;
    }
    const names = Array.from(selectedItems.values()).map((item) => item.name);
    bulkSearchMutation.mutate({ names, force });
  };

  const formatTimestamp = (value: string | null) =>
    value ? formatRelativeTime(value) : 'Never';

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Items</h1>
          <p className="text-muted-foreground text-sm">
            Showing {rangeStart}-{rangeEnd} of {data.total} items
          </p>
        </div>
        <div className="bg-muted/30 text-muted-foreground flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm lg:flex-row lg:items-center lg:gap-4">
          <div className="flex items-center gap-2">
            <span>
              {selectedCount > 0
                ? `${selectedCount} item${selectedCount === 1 ? '' : 's'} selected`
                : 'No items selected'}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkSearchDisabled}
                  onClick={() => runBulkSearch(false)}
                >
                  {bulkSearchMutation.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 size-4" />
                  )}
                  Search
                  <ChevronDown className="ml-1 size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem
                  disabled={bulkSearchMutation.isPending || selectedCount === 0}
                  onSelect={(event) => {
                    event.preventDefault();
                    runBulkSearch(false);
                  }}
                >
                  Search
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={bulkSearchMutation.isPending || selectedCount === 0}
                  onSelect={(event) => {
                    event.preventDefault();
                    runBulkSearch(true);
                  }}
                >
                  Force search
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="bg-border hidden h-4 w-px lg:block" />
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>
              Page {Math.min(page + 1, totalPages)} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="hidden h-7 w-7 p-0 lg:flex"
                onClick={() => setPage(0)}
                disabled={!canGoPrev || isFetching}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                disabled={!canGoPrev || isFetching}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!canGoNext || isFetching}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hidden h-7 w-7 p-0 lg:flex"
                onClick={() => setPage(totalPages - 1)}
                disabled={!canGoNext || isFetching}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
          {selectedCount > MAX_BULK_SELECTION && (
            <span className="text-destructive text-xs">
              Bulk search is limited to {MAX_BULK_SELECTION} items at a time.
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow className="border-b">
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all items on this page"
                  checked={
                    allSelectedOnPage
                      ? true
                      : someSelectedOnPage
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={(value) => toggleSelectAll(toBoolean(value))}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Indexers Searched</TableHead>
              <TableHead>First Searched</TableHead>
              <TableHead>Last Searched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-6 text-center"
                >
                  No items indexed yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const isSelected = selectedItems.has(item.id);
                return (
                  <TableRow
                    key={item.id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={isSelected ? 'bg-muted/60' : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${item.name}`}
                        checked={isSelected}
                        onCheckedChange={(value) =>
                          toggleItem(item, toBoolean(value))
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.indexerCount}</TableCell>
                    <TableCell>
                      {formatTimestamp(item.firstSearchedAt)}
                    </TableCell>
                    <TableCell>
                      {formatTimestamp(item.lastSearchedAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}
