import { TrackerSettings } from '@/pages/Settings/trackers';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/trackers')({
  component: TrackerSettings,
});
