import { createFileRoute } from '@tanstack/react-router';
import { Logs } from '@/features/Logs/Logs';
import { Page } from '@/components/Page';

function LogsPage() {
  return (
    <Page>
      <Logs />
    </Page>
  );
}

export const Route = createFileRoute('/logs')({
  component: LogsPage,
});
