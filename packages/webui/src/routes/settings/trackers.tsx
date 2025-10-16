import { createFileRoute } from '@tanstack/react-router';
import {
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Plus,
  TestTube,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { toast } from 'sonner';
import TrackerViewSheet from '@/components/settings/TrackerViewSheet';
import TrackerEditSheet from '@/components/settings/TrackerEditSheet';
import { Page } from '@/components/Page';

export const Route = createFileRoute('/settings/trackers')({
  component: TrackerSettings,
});

type Indexer = {
  id: number;
  name: string | null;
  url: string;
  enabled: boolean;
  active: boolean;
  status: string | null;
  retryAfter: number | null;
  searchCap: boolean | null;
  tvSearchCap: boolean | null;
  movieSearchCap: boolean | null;
  musicSearchCap: boolean | null;
  audioSearchCap: boolean | null;
  bookSearchCap: boolean | null;
  tvIdCaps: Record<string, boolean> | null;
  movieIdCaps: Record<string, boolean> | null;
  categories: Record<string, boolean> | null;
  limits: Record<string, number> | null;
};

function TrackerSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [viewSheetOpen, setViewSheetOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState<'edit' | 'create'>('create');
  const [selectedTracker, setSelectedTracker] = useState<Indexer | null>(null);
  const [testingTracker, setTestingTracker] = useState<number | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSourceTracker, setMergeSourceTracker] = useState<Indexer | null>(
    null,
  );
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  const { data: indexers } = useSuspenseQuery(
    trpc.indexers.getAll.queryOptions(),
  );
  const { data: archivedIndexers } = useSuspenseQuery(
    trpc.indexers.getArchived.queryOptions(),
  );

  const { mutate: updateIndexer } = useMutation(
    trpc.indexers.update.mutationOptions({
      onSuccess: async () => {
        toast.success('Tracker updated successfully');
        await queryClient.invalidateQueries({
          queryKey: trpc.indexers.getAll.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to update tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: testIndexer } = useMutation(
    trpc.indexers.testExisting.mutationOptions({
      onSuccess: (result) => {
        setTestingTracker(null);
        if (result.success) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      },
      onError: (error) => {
        setTestingTracker(null);
        toast.error(`Test failed: ${error.message}`);
      },
    }),
  );

  const { mutate: mergeArchivedTracker, isPending: isMerging } = useMutation(
    trpc.indexers.mergeArchived.mutationOptions({
      onSuccess: async (result) => {
        toast.success(
          result.mergedCount
            ? `Merged ${result.mergedCount.toLocaleString()} timestamp entries`
            : 'No timestamps needed merging.',
        );
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.indexers.getAll.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.indexers.getArchived.queryKey(),
          }),
        ]);
        setMergeDialogOpen(false);
        setMergeSourceTracker(null);
        setMergeTargetId(null);
      },
      onError: (error) => {
        toast.error(`Failed to merge tracker data: ${error.message}`);
      },
    }),
  );

  const formatRetryAfter = (retryAfter: number) => {
    const date = new Date(retryAfter);
    return date.toLocaleString();
  };

  const getStatusBadge = (indexer: Indexer) => {
    if (!indexer.enabled) {
      return <Badge variant="secondary">Disabled</Badge>;
    }

    if (indexer.status === 'RATE_LIMITED') {
      // Check if rate limit has expired
      if (indexer.retryAfter && Date.now() < indexer.retryAfter) {
        // Still rate limited
        return (
          <Badge
            variant="destructive"
            className="bg-red-700"
            title={`Rate limited until ${formatRetryAfter(indexer.retryAfter)}`}
          >
            Rate Limited
          </Badge>
        );
      } else {
        // Rate limit has expired, show as OK
        return (
          <Badge variant="default" className="bg-green-700">
            OK
          </Badge>
        );
      }
    }

    if (indexer.status === 'UNKNOWN_ERROR') {
      return (
        <Badge variant="destructive" className="bg-red-700">
          Error
        </Badge>
      );
    }

    if (indexer.searchCap === null) {
      return <Badge variant="outline">Unknown</Badge>;
    }

    if (indexer.status === null || indexer.status === 'OK') {
      return (
        <Badge variant="default" className="bg-green-700">
          OK
        </Badge>
      );
    }

    return <Badge variant="outline">{indexer.status}</Badge>;
  };

  const getCapsBadges = (indexer: Indexer) => {
    const caps = [];
    if (indexer.searchCap) caps.push('Search');
    if (indexer.tvSearchCap) caps.push('TV');
    if (indexer.movieSearchCap) caps.push('Movies');
    if (indexer.musicSearchCap) caps.push('Music');
    if (indexer.audioSearchCap) caps.push('Audio');
    if (indexer.bookSearchCap) caps.push('Books');

    if (caps.length === 0) {
      return <span className="text-muted-foreground text-sm">Unknown</span>;
    }

    return (
      <div className="grid auto-cols-max grid-flow-col gap-1">
        {caps.map((cap) => (
          <Badge key={cap} variant="outline" className="text-xs">
            {cap}
          </Badge>
        ))}
      </div>
    );
  };

  const handleAddTracker = () => {
    setSelectedTracker(null);
    setEditMode('create');
    setEditSheetOpen(true);
  };

  const handleViewSheetOpenChange = (open: boolean) => {
    setViewSheetOpen(open);
    if (!open) {
      setOpenDropdown(null); // Close any open dropdown when sheet closes
    }
  };

  const handleEditSheetOpenChange = (open: boolean) => {
    setEditSheetOpen(open);
    if (!open) {
      setOpenDropdown(null); // Close any open dropdown when sheet closes
    }
  };

  const handleViewTracker = (indexer: Indexer) => {
    setOpenDropdown(null); // Close any open dropdown
    setSelectedTracker(indexer);
    setViewSheetOpen(true);
  };

  const handleEditTracker = (indexer: Indexer) => {
    setOpenDropdown(null); // Close any open dropdown
    setSelectedTracker(indexer);
    setEditMode('edit');
    setViewSheetOpen(false); // Close view sheet if open
    setEditSheetOpen(true);
  };

  const handleToggleEnabled = (indexer: Indexer) => {
    updateIndexer({
      id: indexer.id,
      enabled: !indexer.enabled,
    });
  };

  const handleTestTracker = (indexer: Indexer) => {
    setTestingTracker(indexer.id);
    testIndexer({ id: indexer.id });
  };

  const handleMergeTracker = (indexer: Indexer) => {
    if (!indexers?.length) {
      toast.error('No active trackers available to merge into.');
      return;
    }
    setMergeSourceTracker(indexer);
    setMergeTargetId(indexers[0]?.id ?? null);
    setMergeDialogOpen(true);
  };

  const handleMergeDialogOpenChange = (open: boolean) => {
    setMergeDialogOpen(open);
    if (!open) {
      setMergeSourceTracker(null);
      setMergeTargetId(null);
    }
  };

  const handleConfirmMerge = () => {
    if (!mergeSourceTracker || !mergeTargetId) {
      toast.error('Select a destination tracker to merge into.');
      return;
    }
    mergeArchivedTracker({
      sourceId: mergeSourceTracker.id,
      targetId: mergeTargetId,
    });
  };

  const addTrackerButton = (
    <Button onClick={handleAddTracker} size="sm">
      <Plus className="mr-2 h-4 w-4" />
      Add Tracker
    </Button>
  );

  return (
    <Page breadcrumbs={['Settings', 'Trackers']} actions={addTrackerButton}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Trackers</h1>
          <p className="text-muted-foreground">
            Manage your torznab indexers and trackers
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              <TableRow className="border-b">
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {indexers?.map((indexer) => (
                <TableRow
                  key={indexer.id}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleViewTracker(indexer)}
                >
                  <TableCell className="font-medium">
                    {indexer.name || 'Unnamed'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {indexer.url}
                  </TableCell>
                  <TableCell>{getStatusBadge(indexer)}</TableCell>
                  <TableCell>{getCapsBadges(indexer)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu
                      open={openDropdown === indexer.id}
                      onOpenChange={(open) =>
                        setOpenDropdown(open ? indexer.id : null)
                      }
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewTracker(indexer);
                          }}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditTracker(indexer);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestTracker(indexer);
                          }}
                          disabled={testingTracker === indexer.id}
                        >
                          <TestTube className="mr-2 h-4 w-4" />
                          {testingTracker === indexer.id
                            ? 'Testing...'
                            : 'Test Connection'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleEnabled(indexer);
                          }}
                        >
                          {indexer.enabled ? (
                            <>
                              <ToggleLeft className="mr-2 h-4 w-4" />
                              Disable
                            </>
                          ) : (
                            <>
                              <ToggleRight className="mr-2 h-4 w-4" />
                              Enable
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {indexers?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <div className="text-muted-foreground">
                      No trackers configured. Add your first tracker to get
                      started.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-lg border bg-background">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left font-medium"
            onClick={() => setShowArchived((prev) => !prev)}
          >
            <span>Archived Trackers</span>
            {showArchived ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {showArchived && (
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader className="bg-muted sticky top-0 z-10">
                  <TableRow className="border-b">
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedIndexers?.map((indexer) => (
                    <TableRow
                      key={indexer.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => handleViewTracker(indexer)}
                    >
                      <TableCell className="font-medium">
                        {indexer.name || 'Unnamed'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {indexer.url}
                      </TableCell>
                      <TableCell>
                        <Badge variant={indexer.enabled ? 'secondary' : 'outline'}>
                          {indexer.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell>{getCapsBadges(indexer)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewTracker(indexer);
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMergeTracker(indexer);
                            }}
                            disabled={!indexers?.length}
                          >
                            <GitMerge className="mr-2 h-4 w-4" />
                            Merge
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {archivedIndexers?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center">
                        <span className="text-muted-foreground text-sm">
                          No archived trackers.
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <TrackerViewSheet
        open={viewSheetOpen}
        onOpenChange={handleViewSheetOpenChange}
        tracker={selectedTracker}
        onEdit={handleEditTracker}
      />

      <TrackerEditSheet
        open={editSheetOpen}
        onOpenChange={handleEditSheetOpenChange}
        mode={editMode}
        tracker={selectedTracker}
      />

      <AlertDialog
        open={mergeDialogOpen}
        onOpenChange={handleMergeDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Archived Tracker</AlertDialogTitle>
            <AlertDialogDescription>
              Move timestamp history from{' '}
              <span className="font-medium">
                {mergeSourceTracker?.name || mergeSourceTracker?.url || ''}
              </span>{' '}
              into another tracker before permanently deleting it.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium">Merge into</span>
              <Select
                value={mergeTargetId?.toString()}
                onValueChange={(value) => setMergeTargetId(Number(value))}
                disabled={isMerging}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a tracker" />
                </SelectTrigger>
                <SelectContent>
                  {indexers?.map((idx) => (
                    <SelectItem key={idx.id} value={idx.id.toString()}>
                      {idx.name || idx.url}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMerging}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmMerge}
              disabled={isMerging || !mergeTargetId}
            >
              {isMerging ? 'Merging…' : 'Merge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
