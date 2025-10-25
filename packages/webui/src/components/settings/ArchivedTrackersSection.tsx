import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDown, ChevronRight, Eye, GitMerge } from 'lucide-react';

export type ArchivedTracker = {
  id: number;
  name: string | null;
  url: string;
  enabled: boolean;
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

interface ArchivedTrackersSectionProps {
  trackers: ArchivedTracker[] | undefined;
  onView: (tracker: ArchivedTracker) => void;
  onMerge: (tracker: ArchivedTracker) => void;
  disableMerge?: boolean;
  renderCaps: (tracker: ArchivedTracker) => ReactNode;
}

export function ArchivedTrackersSection({
  trackers,
  onView,
  onMerge,
  disableMerge,
  renderCaps,
}: ArchivedTrackersSectionProps) {
  const [open, setOpen] = useState(false);
  if (!trackers || trackers.length === 0) return null;

  return (
    <div className="bg-background rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left font-medium"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>Archived Trackers ({trackers.length})</span>
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {open && (
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
              {trackers.map((tracker) => (
                <TableRow
                  key={tracker.id}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => onView(tracker)}
                >
                  <TableCell className="font-medium">
                    {tracker.name || 'Unnamed'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {tracker.url}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tracker.enabled ? 'secondary' : 'outline'}>
                      {tracker.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell>{renderCaps(tracker)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          onView(tracker);
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
                          onMerge(tracker);
                        }}
                        disabled={disableMerge}
                      >
                        <GitMerge className="mr-2 h-4 w-4" />
                        Merge
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
