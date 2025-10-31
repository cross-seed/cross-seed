import {
  AlertDialogAction,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useImportConfig } from '@/hooks/use-import-config';

interface ImportConfigAlertProps {
  onConfirm: () => void;
}

export default function ImportConfigAlert({
  onConfirm,
}: ImportConfigAlertProps) {
  const { isLoading } = useImportConfig();
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Import Configuration from config.js</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogDescription asChild>
        <p>
          This will import your configuration from the <code>config.js</code>{' '}
          file. Make sure to backup your current configuration before
          proceeding.
        </p>
      </AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={isLoading} onClick={onConfirm}>
          {isLoading ? 'Importing...' : 'Import'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
