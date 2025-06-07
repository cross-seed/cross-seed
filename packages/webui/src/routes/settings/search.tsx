import SearchRssSettings from '@/pages/Settings/search';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/search')({
  component: SearchRssSettings,
});
