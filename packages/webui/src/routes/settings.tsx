import { createFileRoute, Outlet } from '@tanstack/react-router';
import '/assets/form.css';
import ImportConfigButton from '@/features/ImportConfig/import-config-button';

export const Route = createFileRoute('/settings')({
  component: SettingsLayoutComponent,
});

function SettingsLayoutComponent() {
  return (
      <SettingsFormLayout />
  );
}

function SettingsFormLayout() {
  return (
    <div className="mb-5">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Edit Config</h2>
        <ImportConfigButton />
      </div>
      <Outlet />
    </div>
  );
}
