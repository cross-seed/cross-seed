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
import { TestTube, Loader2, Pencil } from 'lucide-react';
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
  tvIdCaps: Record<string, boolean> | null;
  movieIdCaps: Record<string, boolean> | null;
  categories: Record<string, boolean> | null;
  limits: Record<string, number> | null;
};

function ExternalIdBadges({ tvIdCaps, movieIdCaps }: { 
  tvIdCaps: Record<string, boolean> | null; 
  movieIdCaps: Record<string, boolean> | null; 
}) {
  const allProviders = new Set([
    ...(tvIdCaps ? Object.keys(tvIdCaps) : []),
    ...(movieIdCaps ? Object.keys(movieIdCaps) : [])
  ]);

  const badges = [];

  // Non-parenthesized (both TV and Movies) first
  allProviders.forEach(provider => {
    if (tvIdCaps?.[provider] && movieIdCaps?.[provider]) {
      badges.push(
        <Badge key={provider} variant="outline" className="text-xs">
          {provider}
        </Badge>
      );
    }
  });

  // TV-only badges
  allProviders.forEach(provider => {
    if (tvIdCaps?.[provider] && !movieIdCaps?.[provider]) {
      badges.push(
        <Badge key={`${provider}-tv`} variant="outline" className="text-xs">
          {provider} (TV)
        </Badge>
      );
    }
  });

  // Movie-only badges
  allProviders.forEach(provider => {
    if (!tvIdCaps?.[provider] && movieIdCaps?.[provider]) {
      badges.push(
        <Badge key={`${provider}-movie`} variant="outline" className="text-xs">
          {provider} (Movies)
        </Badge>
      );
    }
  });

  return badges.length > 0 ? (
    <>{badges}</>
  ) : (
    <span className="text-muted-foreground text-sm">No external ID support detected</span>
  );
}

interface TrackerViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracker: Indexer | null;
  onEdit?: (tracker: Indexer) => void;
}

export default function TrackerViewSheet({
  open,
  onOpenChange,
  tracker,
  onEdit,
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
            <Label>Search Capabilities</Label>
            <div className="flex flex-wrap gap-2">
              {tracker.searchCap && <Badge variant="outline" className="text-xs">Search</Badge>}
              {tracker.tvSearchCap && <Badge variant="outline" className="text-xs">TV</Badge>}
              {tracker.movieSearchCap && <Badge variant="outline" className="text-xs">Movies</Badge>}
              {tracker.musicSearchCap && <Badge variant="outline" className="text-xs">Music</Badge>}
              {tracker.audioSearchCap && <Badge variant="outline" className="text-xs">Audio</Badge>}
              {tracker.bookSearchCap && <Badge variant="outline" className="text-xs">Books</Badge>}
              {!tracker.searchCap && !tracker.tvSearchCap && !tracker.movieSearchCap && 
               !tracker.musicSearchCap && !tracker.audioSearchCap && !tracker.bookSearchCap && (
                <span className="text-muted-foreground text-sm">No search capabilities detected</span>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>Supported External IDs</Label>
            <div className="flex flex-wrap gap-2">
              <ExternalIdBadges 
                tvIdCaps={tracker.tvIdCaps} 
                movieIdCaps={tracker.movieIdCaps} 
              />
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
          {onEdit && (
            <Button 
              type="button" 
              onClick={() => onEdit(tracker)}
              className="flex-1"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          <SheetClose asChild>
            <Button type="button" variant="outline" className="flex-1">
              Close
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}