import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
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
  editingTracker: Indexer | null;
}

export default function TrackerSheet({
  open,
  onOpenChange,
  editingTracker,
}: TrackerSheetProps) {
  const trpc = useTRPC();
  const [name, setName] = useState(editingTracker?.name || '');
  const [url, setUrl] = useState(editingTracker?.url || '');
  const [apikey, setApikey] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const { mutate: createIndexer, isPending: isCreating } = useMutation(
    trpc.indexers.create.mutationOptions({
      onSuccess: () => {
        toast.success('Tracker created successfully');
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(`Failed to create tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: updateIndexer, isPending: isUpdating } = useMutation(
    trpc.indexers.update.mutationOptions({
      onSuccess: () => {
        toast.success('Tracker updated successfully');
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

    if (editingTracker) {
      updateIndexer({
        id: editingTracker.id,
        name: name.trim() || null,
        url: url.trim(),
        apikey: apikey.trim(),
      });
    } else {
      createIndexer({
        name: name.trim() || undefined,
        url: url.trim(),
        apikey: apikey.trim(),
      });
    }
  };

  const handleTest = () => {
    setIsTesting(true);
    
    if (editingTracker) {
      testExistingIndexer({ id: editingTracker.id });
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
              {editingTracker ? 'Edit Tracker' : 'Add Tracker'}
            </SheetTitle>
            <SheetDescription>
              {editingTracker
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
                required
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
                placeholder="Enter API key"
                autoComplete="off"
                required
              />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={isTesting || (!editingTracker && (!url.trim() || !apikey.trim()))}
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
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {editingTracker ? 'Updating...' : 'Creating...'}
                </>
              ) : editingTracker ? (
                'Update'
              ) : (
                'Create'
              )}
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={isLoading}>
                Cancel
              </Button>
            </SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
