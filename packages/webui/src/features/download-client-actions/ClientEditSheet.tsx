import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { toast } from 'sonner';
import { TestTube, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type DownloadClient = {
  name?: string;
  client: string;
  url: string;
  user: string;
  password: string;
  readOnly?: boolean;
};

interface ClientEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'edit' | 'create';
  client: DownloadClient | null;
}

export default function ClientEditSheet({
  open,
  onOpenChange,
  mode,
  client,
}: ClientEditSheetProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(client?.name || '');
  const [url, setUrl] = useState(client?.url || '');
  const [user, setUser] = useState(client?.user || '');
  const [password, setPassword] = useState(client?.password || '');
  const [readOnly, setReadOnly] = useState(client?.readOnly || false);
  const [isTesting, setIsTesting] = useState(false);

  // Sync form state when client changes
  useEffect(() => {
    if (open) {
      setName(client?.name || '');
      setUrl(client?.url || '');
      setUser(client?.user || '');
      setPassword(client?.password || '');
    }
  }, [open, client]);

  const { mutate: createClient, isPending: isCreating } = useMutation(
    trpc.clients.create.mutationOptions({
      onSuccess: async () => {
        toast.success('Download client created successfully');
        await queryClient.invalidateQueries({
          queryKey: trpc.clients.getAll.queryKey(),
        });
        onOpenChange(false);
      },
      onError: (error: { message: string }) => {
        toast.error(`Failed to create tracker: ${error.message}`);
      },
    }),
  );

  const { mutate: updateClient, isPending: isUpdating } = useMutation(
    trpc.clients.update.mutationOptions({
      onSuccess: async () => {
        toast.success('Download client updated successfully');
        await queryClient.invalidateQueries({
          queryKey: trpc.clients.getAll.queryKey(),
        });
        onOpenChange(false);
      },
      onError: (error: { message: string }) => {
        toast.error(`Failed to update tracker: ${error.message}`);
      },
    }),
  );

  const handleSubmit = () => {
    console.log('Submitting client:', { name, url, user, password });
  };

  const handleTest = () => {
    if (!url.trim() || !user.trim() || !password.trim()) {
      toast.error('Please fill in all fields before testing.');
      return;
    }

    setIsTesting(true);
    // testClientConnection(url, user, password);
  };

  const isLoading = false; //isCreating || isUpdating;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <SheetHeader>
            <SheetTitle>
              {mode === 'edit' ? 'Edit Client' : 'Create Client'}
            </SheetTitle>
            <SheetDescription>
              {mode === 'edit'
                ? 'Edit the details of the download client.'
                : 'Create a new download client.'}
            </SheetDescription>
          </SheetHeader>

          <div className="grid flex-1 auto-rows-min gap-6 px-4">
            <div className="grid gap-3">
              <Label htmlFor="clientName">Client Name</Label>
              <Input
                id="clientName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter client name"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="clientUrl">Client URL</Label>
              <Input
                id="clientUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter client URL"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="clientUser">Username</Label>
              <Input
                id="clientUser"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="Enter username"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="clientPassword">Password</Label>
              <Input
                id="clientPassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter password"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="readOnly">Read only</Label>
              <Switch
                id="readOnly"
                checked={readOnly}
                onCheckedChange={(checked) => setReadOnly(checked)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={
                isTesting || !url.trim() || !user.trim() || !password.trim()
              }
              className="w-full"
            >
              {isTesting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Testing connection...
                </>
              ) : (
                <>
                  <TestTube className="mr-2" />
                  Test Connection
                </>
              )}
            </Button>
          </div>

          <SheetFooter className="mt-6">
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
