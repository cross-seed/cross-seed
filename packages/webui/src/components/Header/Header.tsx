import { Link } from '@tanstack/react-router';
import Logo from '../../../assets/cross-seed.svg';
import { ModeToggle } from '@/components/ModeToggle/ModeToggle';

const Header = () => {
  return (
    <div className="mb-6 flex items-center justify-between">
      <header className="flex items-center gap-2">
        <img
          src={Logo}
          className="h-7 w-7"
          role="presentation"
          alt="cross-seed logo"
        />
        <h1 className="text-2xl font-semibold dark:text-slate-100">
          cross-seed
        </h1>
      </header>
      <nav className="ml-auto">
        <ul className="ml-0 flex list-none items-center gap-6 p-0 dark:text-slate-100">
          <li className="text-sm font-semibold">
            <Link
              to="/"
              activeProps={{ className: 'nav-item--active font-semibold' }}
            >
              Home
            </Link>
          </li>
          <li className="text-sm font-semibold">
            <Link
              to="/logs"
              activeProps={{ className: 'nav-item--active font-semibold' }}
            >
              Logs
            </Link>
          </li>
          <li className="text-sm font-semibold">
            <Link
              to="/config"
              activeProps={{ className: 'nav-item--active font-semibold' }}
            >
              Config
            </Link>
          </li>
        </ul>
      </nav>
      <ModeToggle className="ml-3" />
    </div>
  );
};

export default Header;
