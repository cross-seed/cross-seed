import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/integrations/trpc/setup";
import {
	useMutation,
	useSuspenseQuery,
	useQueryClient,
} from "@tanstack/react-query";

export function LoginForm() {
	const queryClient = useQueryClient();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");

	const { data: authStatus } = useSuspenseQuery(
		trpc.auth.authStatus.queryOptions(),
	);

	const { mutate: login, isPending } = useMutation(
		trpc.auth.logIn.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.auth.authStatus.queryKey(),
				});
			},
			onError: () => {
				setError("Invalid username or password");
			},
		}),
	);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		login({ username, password });
	};

	return (
		<div className="space-y-4 py-2 pb-4">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<h2 className="text-xl font-semibold">
						{authStatus?.userExists ? "Log in" : "Sign up"}
					</h2>
					{error && (
						<div className="text-sm text-red-500">{error}</div>
					)}
				</div>
				<div className="space-y-2">
					<label
						className="text-sm font-medium leading-none"
						htmlFor="username"
					>
						Username
					</label>
					<Input
						id="username"
						placeholder="Username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						disabled={isPending}
						required
					/>
				</div>
				<div className="space-y-2">
					<label
						className="text-sm font-medium leading-none"
						htmlFor="password"
					>
						Password
					</label>
					<Input
						id="password"
						type="password"
						placeholder="Password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={isPending}
						required
					/>
				</div>
				<Button type="submit" disabled={isPending} className="w-full">
					{isPending
						? "Signing in..."
						: authStatus?.userExists
							? "Log in"
							: "Sign up"}
				</Button>
			</form>
		</div>
	);
}
