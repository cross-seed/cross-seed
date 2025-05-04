import { type ReactNode, Suspense } from "react";
import { Navigate } from "@tanstack/react-router";
import { trpc } from "@/integrations/trpc/setup";
import { useSuspenseQuery } from "@tanstack/react-query";

interface ProtectedRouteProps {
	children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	return (
		<Suspense fallback={<div className="animate-pulse">Loading...</div>}>
			<ProtectedRouteContent>{children}</ProtectedRouteContent>
		</Suspense>
	);
}

function ProtectedRouteContent({ children }: ProtectedRouteProps) {
	const { data: authStatus } = useSuspenseQuery(
		trpc.auth.authStatus.queryOptions(),
	);

	if (!authStatus?.userExists) {
		return <Navigate to="/login" />;
	}

	if (!authStatus?.isLoggedIn) {
		return <Navigate to="/login" />;
	}

	return <>{children}</>;
}
