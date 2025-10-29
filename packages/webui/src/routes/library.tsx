import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/Page';

function LibraryPage() {
  return (
    <Page>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Library</h1>
        <p>TODO</p>
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/library')({
  component: LibraryPage,
});
