import ImportConfigButton from '@/features/ImportConfig/import-config-button';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="mb-5">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Edit Config</h2>
        <ImportConfigButton />
      </div>
      {children}
    </div>
  );
}