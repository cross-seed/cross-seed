import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Page } from "@/components/Page";
import { formatRelativeTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  Loader2,
  Search,
  Server,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

type LibrarySource = "torrentClient" | "torrentFile" | "dataDir";
type SourceFilter = "all" | LibrarySource;
type SortBy = "lastSeenAt" | "title" | "length" | "source";
type SortDirection = "asc" | "desc";

function toBoolean(value: boolean | "indeterminate"): boolean {
  return value === true;
}

const PAGE_SIZE = 25;
const MAX_BULK_SELECTION = 20;
const EMPTY_LIBRARY_DATA = {
  items: [],
  total: 0,
  limit: PAGE_SIZE,
  offset: 0,
  sourceCounts: [],
};

const SOURCE_LABELS: Record<LibrarySource, string> = {
  torrentClient: "Client",
  torrentFile: "Torrent dir",
  dataDir: "Data dir",
};

function isScanStatus(status: unknown, value: string): boolean {
  return String(status) === value;
}

function getSourceLabel(source: LibrarySource): string {
  return SOURCE_LABELS[source] ?? source;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatTimestamp(value: string | null) {
  return value ? formatRelativeTime(value) : "Never";
}

function LibraryPage() {
  const trpc = useTRPC();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("lastSeenAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedItems, setSelectedItems] = useState(
    () => new Map<string, { id: string; name: string }>(),
  );

  const queryInput = useMemo(
    () => ({
      search: search.trim() || undefined,
      source: sourceFilter === "all" ? undefined : sourceFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy,
      sortDirection,
    }),
    [page, search, sortBy, sortDirection, sourceFilter],
  );

  const query = useQuery(
    trpc.library.listItems.queryOptions(queryInput, {
      placeholderData: keepPreviousData,
    }),
  );
  const scanQuery = useQuery(
    trpc.library.getScanStatuses.queryOptions(undefined, {
      refetchInterval: (query) => {
        const scans = query.state.data ?? [];
        return scans.some((scan) => isScanStatus(scan.status, "running"))
          ? 2_000
          : 5_000;
      },
    }),
  );

  const { data = EMPTY_LIBRARY_DATA, isFetching, isLoading } = query;
  const items = data.items;
  const scans = scanQuery.data ?? [];
  const sourceCounts = data.sourceCounts;
  const totalIndexed = sourceCounts.reduce((sum, row) => sum + row.count, 0);
  const activeScanCount = scans.filter((scan) =>
    isScanStatus(scan.status, "running"),
  ).length;
  const failedScanCount = scans.filter((scan) =>
    isScanStatus(scan.status, "failed"),
  ).length;
  const latestScan = scans[0] ?? null;

  useEffect(() => {
    setPage(0);
  }, [search, sortBy, sortDirection, sourceFilter]);

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
  const rangeStart = data.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = data.total === 0 ? 0 : page * PAGE_SIZE + items.length;

  const allSelectedOnPage =
    items.length > 0 &&
    items.every((item) => selectedItems.has(item.sourceKey));
  const someSelectedOnPage = items.some((item) =>
    selectedItems.has(item.sourceKey),
  );
  const selectedCount = selectedItems.size;

  const toggleSelectAll = (checked: boolean) => {
    setSelectedItems((prev) => {
      const updated = new Map(prev);
      if (checked) {
        items.forEach((item) =>
          updated.set(item.sourceKey, {
            id: item.sourceKey,
            name: item.title || item.name,
          }),
        );
      } else {
        items.forEach((item) => updated.delete(item.sourceKey));
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
          toast.info("No eligible items to search", {
            description:
              skipped > 0
                ? `${skipped} item${skipped === 1 ? "" : "s"} were skipped by filters.`
                : undefined,
          });
        } else {
          toast.success("Bulk search complete", {
            description: `${attempted} item${attempted === 1 ? "" : "s"} searched${
              skipped ? ` (${skipped} skipped)` : ""
            }. Found ${totalFound} match${totalFound === 1 ? "" : "es"}.`,
          });
        }
        clearSelection();
        void query.refetch();
      },
      onError: (error) => {
        toast.error("Bulk search failed", {
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

  const scanSummary = latestScan
    ? `Latest ${getSourceLabel(latestScan.source)} scan ${formatTimestamp(
        latestScan.finishedAt ?? latestScan.startedAt,
      )} · saw ${latestScan.itemsSeen} item${
        latestScan.itemsSeen === 1 ? "" : "s"
      }`
    : null;

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Library</h1>
            {activeScanCount > 0 && (
              <Badge variant="secondary">
                <Loader2 className="size-3 animate-spin" />
                Indexing
              </Badge>
            )}
            {activeScanCount === 0 && failedScanCount > 0 && (
              <Badge variant="destructive">Indexing failed</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Showing {rangeStart}-{rangeEnd} of {data.total} indexed items
            {scanSummary ? ` · ${scanSummary}` : ""}
          </p>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-end gap-3 text-sm">
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span>
                {selectedCount} item{selectedCount === 1 ? "" : "s"} selected
              </span>
              {selectedCount > MAX_BULK_SELECTION && (
                <span className="text-destructive text-xs">
                  Limit {MAX_BULK_SELECTION}
                </span>
              )}
            </div>
          )}
          {selectedCount > 0 && (
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
          )}
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>
              Page {Math.min(page + 1, totalPages)} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
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
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant={sourceFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSourceFilter("all")}
          >
            All
            <span className="text-muted-foreground ml-1 text-xs">
              {totalIndexed}
            </span>
          </Button>
          {(["torrentClient", "torrentFile", "dataDir"] as const).map(
            (source) => {
              const count =
                sourceCounts.find((row) => row.source === source)?.count ?? 0;
              return (
                <Button
                  key={source}
                  type="button"
                  variant={sourceFilter === source ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSourceFilter(source)}
                >
                  {getSourceLabel(source)}
                  <span className="text-muted-foreground ml-1 text-xs">
                    {count}
                  </span>
                </Button>
              );
            },
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter library"
              className="h-8 w-64 pl-8"
            />
          </div>
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as SortBy)}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastSeenAt">Last seen</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="length">Size</SelectItem>
              <SelectItem value="source">Source</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortDirection}
            onValueChange={(value) => setSortDirection(value as SortDirection)}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={`overflow-x-auto rounded-lg border transition-opacity ${
          isFetching && !isLoading ? "opacity-70" : ""
        }`}
      >
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
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(value) => toggleSelectAll(toBoolean(value))}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Files</TableHead>
              <TableHead>Last Indexed</TableHead>
              <TableHead>Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-muted-foreground text-sm">
                      No indexed library items.
                    </span>
                    <span className="text-muted-foreground max-w-md text-xs">
                      Add torrent sources, then cross-seed will index them and
                      show rows here as they are persisted.
                    </span>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button asChild size="sm">
                        <Link to="/settings/clients">
                          <Server className="mr-2 size-4" />
                          Add torrent sources
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/settings/directories">
                          <Folder className="mr-2 size-4" />
                          Add data dirs
                        </Link>
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const itemId = item.sourceKey;
                const itemName = item.title || item.name;
                const source = item.source;
                const isSelected = selectedItems.has(itemId);
                return (
                  <TableRow
                    key={itemId}
                    data-state={isSelected ? "selected" : undefined}
                    className={isSelected ? "bg-muted/60" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${itemName}`}
                        checked={isSelected}
                        onCheckedChange={(value) =>
                          toggleItem(
                            { id: itemId, name: itemName },
                            toBoolean(value),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-64 font-medium">
                      <div className="flex flex-col">
                        <span>{itemName}</span>
                        <span className="text-muted-foreground text-xs">
                          {item.infoHash ?? item.clientHost ?? item.sourceKey}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getSourceLabel(source)}</Badge>
                    </TableCell>
                    <TableCell>{formatBytes(item.length)}</TableCell>
                    <TableCell>{item.fileCount}</TableCell>
                    <TableCell>{formatTimestamp(item.lastIndexedAt)}</TableCell>
                    <TableCell className="text-muted-foreground max-w-sm truncate font-mono text-xs">
                      {item.path ?? item.savePath ?? item.sourceInstance ?? "-"}
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
