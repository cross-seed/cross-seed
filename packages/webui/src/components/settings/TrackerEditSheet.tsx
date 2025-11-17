import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  enabled: boolean;
  status: string | null;
  retryAfter: number | null;
  searchCap: boolean | null;
  tvSearchCap: boolean | null;
  movieSearchCap: boolean | null;
  musicSearchCap: boolean | null;
  audioSearchCap: boolean | null;
  bookSearchCap: boolean | null;
};

interface TrackerEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'edit' | 'create';
  tracker: Indexer | null;
}

export default function TrackerEditSheet({
  open,
  onOpenChange,
  mode,
  tracker,
}: TrackerEditSheetProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(tracker?.name || '');
  const [url, setUrl] = useState(tracker?.url || '');
  const [apikey, setApikey] = useState('');
  const [enabled, setEnabled] = useState(tracker?.enabled ?? true);
  const [isTesting, setIsTesting] = useState(false);

  // Sync form state when tracker changes
  useEffect(() => {
    if (open) {
      setName(tracker?.name || '');
      setUrl(tracker?.url || '');
      setApikey(''); // Always reset API key for security
      setEnabled(tracker?.enabled ?? true);
    }
  }, [open, tracker]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }

    // Validate URL format for torznab API
    const trimmedUrl = url.trim();
    if (!trimmedUrl.endsWith('/api')) {
      toast.error('URL must end with /api');
      return;
    }

    // Check for apikey parameter in URL
    try {
      const urlObj = new URL(trimmedUrl);
      if (!urlObj.searchParams.has('apikey')) {
        toast.error(
          'URL must include apikey parameter (e.g., ?apikey=YOUR_KEY)',
        );
        return;
      }
    } catch {
      toast.error('Invalid URL format');
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
        enabled,
      });
    } else if (mode === 'create') {
      createIndexer({
        name: name.trim() || undefined,
        url: url.trim(),
        apikey: apikey.trim(),
        enabled,
      });
    }
  };

  const handleTest = () => {
    if (!url.trim() || !apikey.trim()) {
      toast.error('URL and API key are required for testing');
      return;
    }

    setIsTesting(true);
    testNewIndexer({
      url: url.trim(),
      apikey: apikey.trim(),
    });
  };

  const isLoading = isCreating || isUpdating;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <SheetHeader>
            <SheetTitle>
              {mode === 'edit' ? 'Edit Tracker' : 'Add Tracker'}
            </SheetTitle>
            <SheetDescription>
              {mode === 'edit'
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

            <div className="flex items-center justify-between">
              <Label htmlFor="tracker-enabled" className="text-sm font-medium">
                Enable Search and RSS
              </Label>
              <Switch
                id="tracker-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
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
              disabled={isTesting || !url.trim() || !apikey.trim()}
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
            {/* TODO: update to form.AppForm -> form.submitbutton */}
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
