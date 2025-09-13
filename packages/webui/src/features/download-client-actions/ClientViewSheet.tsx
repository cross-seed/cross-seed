import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet';
import { Pencil } from 'lucide-react';

// ! FIXME: consolidate this type in a types.ts file and import it
// Same as the one in downloaders.tsx
type DownloadClient = {
  name?: string;
  client: string;
  url: string;
  user: string;
  password: string;
  readOnly?: boolean;
};

interface ClientViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: DownloadClient | null;
  onEdit?: (client: DownloadClient) => void;
}

export default function ClientViewSheet({
  open,
  onOpenChange,
  client,
  onEdit,
}: ClientViewSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>View Download Client</SheetTitle>
          <SheetDescription>View download client details.</SheetDescription>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="grid gap-3">
            <Label>Download Client Name</Label>
            <div className="bg-muted/50 rounded-md border px-3 py-2 text-sm">
              {client?.name || 'N/A'}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>URL</Label>
            <div className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm break-all">
              {client?.url || 'N/A'}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>Username</Label>
            <div className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm break-all">
              {client?.user || 'N/A'}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>Password</Label>
            <div className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm break-all">
              {client?.password ? '********' : 'N/A'}
            </div>
          </div>

          <div className="grid gap-3">
            <Label>Read only</Label>
            <div className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm break-all">
              {client?.readOnly ? 'Yes' : 'No'}
            </div>
          </div>
        </div>

        <SheetFooter>
          {onEdit && (
            <Button
              type="button"
              onClick={() => onEdit(client)}
              className="flex-1"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          <SheetClose asChild className="flex-1">
            <Button type="button" variant="outline" className="flex-1">
              Close
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
