import { createFileRoute } from '@tanstack/react-router';
import GeneralSettings from '@/pages/Settings/general';

export const Route = createFileRoute('/settings/')({
  component: GeneralSettings,
});
