import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTRPC } from '@/lib/trpc';
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
import { Plus, TestTube, ToggleLeft, ToggleRight, MoreHorizontal, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import TrackerViewSheet from '@/components/settings/TrackerViewSheet';
import TrackerEditSheet from '@/components/settings/TrackerEditSheet';

export const Route = createFileRoute('/settings/trackers')({
  component: TrackerSettings,
});

type Indexer = {
  id: number;
  name: string | null;
  url: string;
  active: boolean;
  status: string | null;
  retryAfter: number | null;
  searchCap: boolean | null;
  tvSearchCap: boolean | null;
  movieSearchCap: boolean | null;
  musicSearchCap: boolean | null;
  audioSearchCap: boolean | null;
  bookSearchCap: boolean | null;
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

  const { data: indexers } = useSuspenseQuery(
    trpc.indexers.getAll.queryOptions(undefined, {
      refetchInterval: 10000, // Refresh every 10 seconds
    }),
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

  const formatRetryAfter = (retryAfter: number) => {
    const date = new Date(retryAfter);
    return date.toLocaleString();
  };

  const getStatusBadge = (indexer: Indexer) => {
    if (!indexer.active) {
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
      <div className="flex flex-wrap gap-1">
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
    setEditSheetOpen(true);
  };

  const handleToggleActive = (indexer: Indexer) => {
    updateIndexer({
      id: indexer.id,
      active: !indexer.active,
    });
  };

  const handleTestTracker = (indexer: Indexer) => {
    setTestingTracker(indexer.id);
    testIndexer({ id: indexer.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trackers</h1>
          <p className="text-muted-foreground">
            Manage your torznab indexers and trackers
          </p>
        </div>
        <Button onClick={handleAddTracker}>
          <Plus className="mr-2 h-4 w-4" />
          Add Tracker
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
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
                className="hover:bg-muted/50"
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
                    onOpenChange={(open) => setOpenDropdown(open ? indexer.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => handleViewTracker(indexer)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditTracker(indexer)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => handleTestTracker(indexer)}
                        disabled={testingTracker === indexer.id}
                      >
                        <TestTube className="mr-2 h-4 w-4" />
                        {testingTracker === indexer.id ? 'Testing...' : 'Test Connection'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActive(indexer)}>
                        {indexer.active ? (
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
                <TableCell colSpan={4} className="py-8 text-center">
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

      <TrackerViewSheet
        open={viewSheetOpen}
        onOpenChange={handleViewSheetOpenChange}
        tracker={selectedTracker}
      />
      
      <TrackerEditSheet
        open={editSheetOpen}
        onOpenChange={handleEditSheetOpenChange}
        mode={editMode}
        tracker={selectedTracker}
      />
    </div>
  );
}
