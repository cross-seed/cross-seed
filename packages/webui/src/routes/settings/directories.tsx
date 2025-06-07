import DirectorySettings from '@/pages/Settings/directories';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/directories')({
  component: DirectorySettings,
});
