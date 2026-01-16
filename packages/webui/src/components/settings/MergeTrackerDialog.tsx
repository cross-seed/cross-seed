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

export type TrackerSummary = {
  id: number;
  name: string | null;
  url: string;
};

interface MergeTrackerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceTracker: TrackerSummary | null;
  targetId: number | null;
  onTargetChange: (id: number | null) => void;
  onConfirm: () => void;
  isMerging?: boolean;
  availableTargets: TrackerSummary[];
}

export function MergeTrackerDialog({
  open,
  onOpenChange,
  sourceTracker,
  targetId,
  onTargetChange,
  onConfirm,
  isMerging,
  availableTargets,
}: MergeTrackerDialogProps) {
  const handleChange = (value: string) => {
    onTargetChange(Number(value));
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge Disabled Tracker</AlertDialogTitle>
          <AlertDialogDescription>
            Move timestamp history from{' '}
            <span className="font-medium">
              {sourceTracker?.name || sourceTracker?.url || ''}
            </span>{' '}
            into another tracker before permanently deleting it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium">Merge into</span>
            <Select
              value={targetId?.toString()}
              onValueChange={handleChange}
              disabled={isMerging}
            >
              <SelectTrigger className="mt-1 min-h-[3rem] items-center justify-between">
                <SelectValue placeholder="Select a tracker" />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.map((idx) => (
                  <SelectItem key={idx.id} value={idx.id.toString()}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{idx.name || idx.url}</span>
                      <span className="text-muted-foreground text-xs break-all">
                        {idx.url}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isMerging}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isMerging || !targetId}
          >
            {isMerging ? 'Merging…' : 'Merge'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
