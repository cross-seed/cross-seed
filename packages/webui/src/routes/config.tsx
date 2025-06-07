import { ConfigFormProvider } from '@/contexts/Form/config-form-provider';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import '/assets/form.css';

export const Route = createFileRoute('/config')({
  component: ConfigLayoutComponent,
});

function ConfigLayoutComponent() {
  return (
    <ConfigFormProvider>
      <ConfigFormLayout />
    </ConfigFormProvider>
  );
}

function ConfigFormLayout() {
  return (
    <div className="mb-5">
      <h2 className="mb-6 text-2xl font-semibold">Edit Config</h2>
      <Outlet />
    </div>
  );
}
