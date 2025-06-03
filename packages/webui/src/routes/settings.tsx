import { createFileRoute } from '@tanstack/react-router';
import { Settings } from '@/pages/Settings/Settings.tsx';

export const Route = createFileRoute('/settings')({
  component: Settings,
});
