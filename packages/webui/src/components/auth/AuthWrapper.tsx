import { LoginForm } from '@/components/login-form';
import { useTRPC } from '@/lib/trpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type AuthWrapperProps = {
  children: ReactNode;
};

export function Login({ children }: AuthWrapperProps) {
  const trpc = useTRPC();
  const { data: authStatus } = useSuspenseQuery(
    trpc.auth.authStatus.queryOptions(),
  );

  // If not logged in, show login form
  if (!authStatus?.isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md px-4">
          <LoginForm />
        </div>
      </div>
    );
  }

  return children;
}
