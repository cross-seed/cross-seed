import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Suspense } from "react";
import { trpc } from "@/integrations/trpc/setup";
import {
	useMutation,
	useSuspenseQuery,
	useQueryClient,
} from "@tanstack/react-query";

export default function Header() {
	return (
		<header className="p-2 flex gap-2 bg-white text-black justify-between items-center">
			<nav className="flex flex-row">
				<div className="px-2 font-bold">
					<Link to="/">Cross-Seed</Link>
				</div>
			</nav>

			<Suspense fallback={null}>
				<UserActions />
			</Suspense>
		</header>
	);
}

function UserActions() {
	const queryClient = useQueryClient();
	const { data: authStatus } = useSuspenseQuery(
		trpc.auth.authStatus.queryOptions(),
	);

	const { mutate: logout } = useMutation(
		trpc.auth.logOut.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.auth.authStatus.queryKey(),
				});
			},
		}),
	);

	if (!authStatus?.isLoggedIn) {
		// Don't show any login button, as login form will be shown automatically
		return null;
	}

	return (
		<div className="flex gap-4 items-center">
			{authStatus.user && (
				<span className="text-sm">{authStatus.user.username}</span>
			)}
			<Button variant="outline" size="sm" onClick={() => logout()}>
				Logout
			</Button>
		</div>
	);
}
