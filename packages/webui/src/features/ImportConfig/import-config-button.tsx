import { FC, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import ImportConfigAlert from './import-config-alert';
import { useImportConfig } from '@/hooks/use-import-config';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { toast } from 'sonner';

const ImportConfigButton: FC = () => {
  const [open, setOpen] = useState(false);
  const trpc = useTRPC();
  const { importConfig } = useImportConfig();
  const { data: settingsData } = useQuery(
    trpc.settings.get.queryOptions(undefined, {
      enabled: open,
      select: (data) => data.config,
    }),
  );

  const handleStartImport = () => {
    // Logic to handle import configuration
    if (!settingsData) {
      toast.error('No settings data available for import.');
      return;
    }

    try {
      console.log('the data', settingsData);
      importConfig(settingsData, {
        onSuccess: () => {
          toast.success('Configuration imported successfully!');
        },
        onError: (error) => {
          toast.error(`Failed to import configuration: ${error.message}`);
        },
      });
    } catch (error) {
      toast.error(`Error during import: ${error}`);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">Import Config</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <ImportConfigAlert onConfirm={handleStartImport} />
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ImportConfigButton;
