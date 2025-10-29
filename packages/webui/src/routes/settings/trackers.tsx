import { createFileRoute } from '@tanstack/react-router';
import {
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useTRPC } from '@/lib/trpc';
import {
  ArchivedTrackersSection,
  type ArchivedTracker,
} from '@/components/settings/ArchivedTrackersSection';
import { MergeArchivedDialog } from '@/components/settings/MergeArchivedDialog';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Eye,
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

type Tracker = {
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
  const [selectedTracker, setSelectedTracker] = useState<Tracker | null>(null);
  const [testingTracker, setTestingTracker] = useState<number | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSourceTracker, setMergeSourceTracker] =
    useState<ArchivedTracker | null>(null);
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

  const getStatusBadge = (indexer: Tracker) => {
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

  type TrackerWithCaps = Pick<
    Tracker,
    | 'searchCap'
    | 'tvSearchCap'
    | 'movieSearchCap'
    | 'musicSearchCap'
    | 'audioSearchCap'
    | 'bookSearchCap'
  > | ArchivedTracker;

  const getCapsBadges = (indexer: TrackerWithCaps) => {
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

  const handleViewTracker = (indexer: Tracker) => {
    setOpenDropdown(null); // Close any open dropdown
    setSelectedTracker(indexer);
    setViewSheetOpen(true);
  };

  const handleEditTracker = (indexer: Tracker) => {
    if (!indexer.active) {
      toast.error('Archived trackers cannot be edited.');
      return;
    }
    setOpenDropdown(null); // Close any open dropdown
    setSelectedTracker(indexer);
    setEditMode('edit');
    setViewSheetOpen(false); // Close view sheet if open
    setEditSheetOpen(true);
  };

  const handleToggleEnabled = (indexer: Tracker) => {
    updateIndexer({
      id: indexer.id,
      enabled: !indexer.enabled,
    });
  };

  const handleTestTracker = (indexer: Tracker) => {
    setTestingTracker(indexer.id);
    testIndexer({ id: indexer.id });
  };

  const handleMergeTracker = (indexer: ArchivedTracker) => {
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

        <ArchivedTrackersSection
          trackers={archivedIndexers}
          onView={handleViewTracker}
          onMerge={handleMergeTracker}
          disableMerge={!indexers?.length}
          renderCaps={getCapsBadges}
        />
      </div>

      <TrackerViewSheet
        open={viewSheetOpen}
        onOpenChange={handleViewSheetOpenChange}
        tracker={selectedTracker}
        onEdit={
          selectedTracker && selectedTracker.active
            ? handleEditTracker
            : undefined
        }
      />

      <TrackerEditSheet
        open={editSheetOpen}
        onOpenChange={handleEditSheetOpenChange}
        mode={editMode}
        tracker={selectedTracker}
      />

      <MergeArchivedDialog
        open={mergeDialogOpen}
        onOpenChange={handleMergeDialogOpenChange}
        sourceTracker={mergeSourceTracker}
        targetId={mergeTargetId}
        onTargetChange={setMergeTargetId}
        onConfirm={handleConfirmMerge}
        isMerging={isMerging}
        availableTargets={(indexers ?? []).map((idx) => ({
          id: idx.id,
          name: idx.name,
          url: idx.url,
        }))}
      />
    </Page>
  );
}
