import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/Page';

function ProblemsSettingsPage() {
  return (
    <Page breadcrumbs={['Settings', 'Problems']}>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Problems</h1>
        <p>TODO</p>
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/settings/problems')({
  component: ProblemsSettingsPage,
});
