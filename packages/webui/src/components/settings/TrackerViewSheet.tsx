import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useState } from 'react';

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

interface TrackerViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracker: Indexer | null;
}

export default function TrackerViewSheet({
  open,
  onOpenChange,
  tracker,
}: TrackerViewSheetProps) {
  const trpc = useTRPC();
  const [isTesting, setIsTesting] = useState(false);

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

  const handleTest = () => {
    if (!tracker) return;
    setIsTesting(true);
    testExistingIndexer({ id: tracker.id });
  };

  if (!tracker) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>View Tracker</SheetTitle>
          <SheetDescription>
            View tracker details and capabilities.
          </SheetDescription>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="grid gap-3">
            <Label>Tracker Name</Label>
            <div className="px-3 py-2 border rounded-md bg-muted/50 text-sm">
              {tracker.name || 'Unnamed'}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>URL</Label>
            <div className="px-3 py-2 border rounded-md bg-muted/50 text-sm font-mono break-all">
              {tracker.url}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>API Key</Label>
            <div className="px-3 py-2 border rounded-md bg-muted/50 text-sm text-muted-foreground">
              Hidden for security
            </div>
          </div>

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

          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={isTesting}
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
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}