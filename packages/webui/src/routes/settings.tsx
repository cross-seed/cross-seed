import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ConfigFormProvider } from '@/contexts/Form/config-form-provider';
// import { Settings } from '@/pages/Settings/Settings.tsx';
import '/assets/form.css';

export const Route = createFileRoute('/settings')({
  component: SettingsLayoutComponent,
});

function SettingsLayoutComponent() {
  return (
    <ConfigFormProvider>
      <SettingsFormLayout />
    </ConfigFormProvider>
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
