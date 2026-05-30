import { createFileRoute, Outlet } from '@tanstack/react-router';
import '/assets/form.css';

export const Route = createFileRoute('/settings')({
  component: SettingsLayoutComponent,
});

function SettingsLayoutComponent() {
  return <Outlet />;
}
