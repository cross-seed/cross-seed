import IndexerSettings from '@/pages/Settings/indexers';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/indexers')({
  component: IndexerSettings,
});
