import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery, useMutation } from '@tanstack/react-query';
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
  Plus, 
  TestTube, 
  ToggleLeft, 
  ToggleRight 
} from 'lucide-react';
import { toast } from 'sonner';
import TrackerSheet from '@/components/settings/TrackerSheet';

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTracker, setEditingTracker] = useState<Indexer | null>(null);
  const [testingTracker, setTestingTracker] = useState<number | null>(null);

  const { data: indexers } = useSuspenseQuery(
    trpc.indexers.getAll.queryOptions(undefined, {
      refetchInterval: 10000, // Refresh every 10 seconds
    }),
  );

  const { mutate: updateIndexer } = useMutation(
    trpc.indexers.update.mutationOptions({
      onSuccess: () => {
        toast.success('Tracker updated successfully');
      },
      onError: (error) => {
        toast.error(`Failed to update tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: testIndexer } = useMutation(
    trpc.indexers.test.mutationOptions({
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
        return <Badge variant="default" className="bg-green-700">OK</Badge>;
      }
    }
    
    if (indexer.status === 'UNKNOWN_ERROR') {
      return <Badge variant="destructive" className="bg-red-700">Error</Badge>;
    }
    
    if (indexer.searchCap === null) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    
    if (indexer.status === null || indexer.status === 'OK') {
      return <Badge variant="default" className="bg-green-700">OK</Badge>;
    }
    
    return <Badge variant="outline">{indexer.status}</Badge>;
  };

  const handleAddTracker = () => {
    setEditingTracker(null);
    setSheetOpen(true);
  };

  const handleEditTracker = (indexer: Indexer) => {
    setEditingTracker(indexer);
    setSheetOpen(true);
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
      <div className="flex justify-between items-center">
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {indexers?.map((indexer) => (
              <TableRow 
                key={indexer.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleEditTracker(indexer)}
              >
                <TableCell className="font-medium">
                  {indexer.name || 'Unnamed'}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {indexer.url}
                </TableCell>
                <TableCell>{getStatusBadge(indexer)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleActive(indexer);
                      }}
                      title={indexer.active ? 'Disable' : 'Enable'}
                    >
                      {indexer.active ? (
                        <ToggleRight className="h-4 w-4 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTestTracker(indexer);
                      }}
                      disabled={testingTracker === indexer.id}
                      title="Test Connection"
                    >
                      <TestTube className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {indexers?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8">
                  <div className="text-muted-foreground">
                    No trackers configured. Add your first tracker to get started.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TrackerSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editingTracker={editingTracker}
      />
    </div>
  );
}