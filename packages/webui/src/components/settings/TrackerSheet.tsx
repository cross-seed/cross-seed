import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from 'sonner';
import { TestTube, Loader2 } from 'lucide-react';

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

interface TrackerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'view' | 'edit' | 'create';
  tracker: Indexer | null;
}

export default function TrackerSheet({
  open,
  onOpenChange,
  mode,
  tracker,
}: TrackerSheetProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(tracker?.name || '');
  const [url, setUrl] = useState(tracker?.url || '');
  const [apikey, setApikey] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const { mutate: createIndexer, isPending: isCreating } = useMutation(
    trpc.indexers.create.mutationOptions({
      onSuccess: async () => {
        toast.success('Tracker created successfully');
        await queryClient.invalidateQueries({
          queryKey: trpc.indexers.getAll.queryKey(),
        });
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(`Failed to create tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: updateIndexer, isPending: isUpdating } = useMutation(
    trpc.indexers.update.mutationOptions({
      onSuccess: async () => {
        toast.success('Tracker updated successfully');
        await queryClient.invalidateQueries({
          queryKey: trpc.indexers.getAll.queryKey(),
        });
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(`Failed to update tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: testNewIndexer } = useMutation(
    trpc.indexers.testNew.mutationOptions({
      onSuccess: (result) => {
        setIsTesting(false);
        if (result.success) {
          toast.success('Connection test successful!');
        } else {
          toast.error(`Connection test failed: ${result.message}`);
        }
      },
      onError: (error) => {
        setIsTesting(false);
        toast.error(`Test failed: ${error.message}`);
      },
    }),
  );

  const { mutate: testExistingIndexer } = useMutation(
    trpc.indexers.testExisting.mutationOptions({
      onSuccess: (result) => {
        setIsTesting(false);
        if (result.success) {
          toast.success('Connection test successful!');
        } else {
          toast.error(`Connection test failed: ${result.message}`);
        }
      },
      onError: (error) => {
        setIsTesting(false);
        toast.error(`Test failed: ${error.message}`);
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }

    if (!apikey.trim()) {
      toast.error('API key is required');
      return;
    }

    if (mode === 'edit' && tracker) {
      updateIndexer({
        id: tracker.id,
        name: name.trim() || null,
        url: url.trim(),
        apikey: apikey.trim(),
      });
    } else if (mode === 'create') {
      createIndexer({
        name: name.trim() || undefined,
        url: url.trim(),
        apikey: apikey.trim(),
      });
    }
  };

  const handleTest = () => {
    setIsTesting(true);
    
    if (mode === 'edit' && tracker) {
      testExistingIndexer({ id: tracker.id });
    } else {
      if (!url.trim() || !apikey.trim()) {
        toast.error('URL and API key are required for testing');
        setIsTesting(false);
        return;
      }
      testNewIndexer({
        url: url.trim(),
        apikey: apikey.trim(),
      });
    }
  };

  const isLoading = isCreating || isUpdating;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <SheetHeader>
            <SheetTitle>
              {mode === 'view' ? 'View Tracker' : mode === 'edit' ? 'Edit Tracker' : 'Add Tracker'}
            </SheetTitle>
            <SheetDescription>
              {mode === 'view'
                ? 'View tracker details and capabilities.'
                : mode === 'edit'
                ? 'Update the tracker details below.'
                : 'Add a new torznab indexer or tracker.'}
            </SheetDescription>
          </SheetHeader>

          <div className="grid flex-1 auto-rows-min gap-6 px-4">
            <div className="grid gap-3">
              <Label htmlFor="name">Tracker Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Indexer"
                autoComplete="off"
                readOnly={mode === 'view'}
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://indexer.example.com/api"
                autoComplete="url"
                required={mode !== 'view'}
                readOnly={mode === 'view'}
              />
              <p className="text-muted-foreground text-sm">
                Must end with /api and include apikey parameter
              </p>
            </div>

            <div className="grid gap-3">
              <Label htmlFor="apikey">API Key</Label>
              <Input
                id="apikey"
                type="password"
                value={apikey}
                onChange={(e) => setApikey(e.target.value)}
                placeholder={mode === 'view' ? 'Hidden for security' : 'Enter API key'}
                autoComplete="off"
                required={mode !== 'view'}
                readOnly={mode === 'view'}
              />
            </div>

            {mode === 'view' && tracker && (
              <div className="grid gap-3">
                <Label>Capabilities</Label>
                <div className="flex flex-wrap gap-2">
                  {tracker.searchCap && <Badge variant="outline" className="text-xs">Search</Badge>}
                  {tracker.tvSearchCap && <Badge variant="outline" className="text-xs">TV</Badge>}
                  {tracker.movieSearchCap && <Badge variant="outline" className="text-xs">Movies</Badge>}
                  {tracker.musicSearchCap && <Badge variant="outline" className="text-xs">Music</Badge>}
                  {tracker.audioSearchCap && <Badge variant="outline" className="text-xs">Audio</Badge>}
                  {tracker.bookSearchCap && <Badge variant="outline" className="text-xs">Books</Badge>}
                  {!tracker.searchCap && !tracker.tvSearchCap && !tracker.movieSearchCap && 
                   !tracker.musicSearchCap && !tracker.audioSearchCap && !tracker.bookSearchCap && (
                    <span className="text-muted-foreground text-sm">No capabilities detected</span>
                  )}
                </div>
              </div>
            )}

            {mode === 'view' && tracker && (
              <div className="grid gap-3">
                <Label>Status</Label>
                <div>
                  {tracker.active ? (
                    <Badge variant="default" className="bg-green-700">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                  {tracker.status && tracker.status !== 'OK' && (
                    <Badge variant="outline" className="ml-2">{tracker.status}</Badge>
                  )}
                </div>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={isTesting || (mode === 'create' && (!url.trim() || !apikey.trim()))}
              className="w-full"
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <TestTube className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>

          <SheetFooter>
            {mode !== 'view' && (
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === 'edit' ? 'Updating...' : 'Creating...'}
                  </>
                ) : mode === 'edit' ? (
                  'Update'
                ) : (
                  'Create'
                )}
              </Button>
            )}
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={isLoading}>
                {mode === 'view' ? 'Close' : 'Cancel'}
              </Button>
            </SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
