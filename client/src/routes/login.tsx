import { createFileRoute, Navigate } from "@tanstack/react-router";

// This route is now redundant as login happens at the root level
// We keep it to maintain routing structure but just redirect to home
export const Route = createFileRoute("/login")({
	component: () => <Navigate to="/" />,
});
