import { type ReactNode, Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { trpc } from "@/integrations/trpc/setup";
import { useSuspenseQuery } from "@tanstack/react-query";

interface AuthWrapperProps {
  children: ReactNode;
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AuthContent>{children}</AuthContent>
    </Suspense>
  );
}

function AuthContent({ children }: AuthWrapperProps) {
  const { data: authStatus } = useSuspenseQuery(
    trpc.auth.authStatus.queryOptions()
  );

  // If not logged in, show login form
  if (!authStatus?.isLoggedIn) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-sm w-full p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-6 text-center">
            {authStatus?.userExists ? "Sign In" : "Initial Setup"}
          </h1>
          <LoginForm />
        </div>
      </div>
    );
  }

  // If logged in, show the actual page content
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}