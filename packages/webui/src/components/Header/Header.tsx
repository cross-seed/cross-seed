import { ModeToggle } from '@/components/ModeToggle/ModeToggle';
import { useSidebar } from '@/components/ui/sidebar';

const Header = () => {
  const { open } = useSidebar();

  return (
    <div className="mb-6 flex items-center justify-between">
      {!open && (
        <header className="flex items-center gap-2">
          <img
            src="/assets/cross-seed.svg"
            className="mt-1 h-6 w-6"
            role="presentation"
            alt="cross-seed logo"
          />
          <h1 className="text-2xl font-semibold">cross-seed</h1>
        </header>
      )}
      <ModeToggle className="ml-auto justify-self-end" />
    </div>
  );
};

export default Header;
