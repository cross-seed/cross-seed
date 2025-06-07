import DownloaderSettings from '@/pages/Settings/downloaders';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/downloaders')({
  component: DownloaderSettings,
});
