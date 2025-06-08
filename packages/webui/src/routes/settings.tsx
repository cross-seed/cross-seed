import { createFileRoute, Outlet } from '@tanstack/react-router';
import '/assets/form.css';

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
      <h2 className="mb-6 text-2xl font-semibold">Edit Config</h2>
      <Outlet />
    </div>
  );
}
