import ConnectSettings from '@/pages/Settings/connect';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/connect')({
  component: ConnectSettings,
});
