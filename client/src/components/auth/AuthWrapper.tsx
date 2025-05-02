import { LoginForm } from "@/components/login-form";
import { trpc } from "@/integrations/trpc/setup";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

type AuthWrapperProps = {
	children: ReactNode;
};

export function Login({ children }: AuthWrapperProps) {
	const { data: authStatus } = useSuspenseQuery(
		trpc.auth.authStatus.queryOptions(),
	);

	// If not logged in, show login form
	if (!authStatus?.isLoggedIn) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="max-w-md w-full px-4">
					<LoginForm />
				</div>
			</div>
		);
	}
	
	return children;
}
