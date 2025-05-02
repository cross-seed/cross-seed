import { TrpcProvider } from "@/integrations/trpc/TrpcProvider";
import { getContext as getTrpcContext } from "@/integrations/trpc/setup";

export function getContext() {
	return getTrpcContext();
}

export function Provider({ children }: { children: React.ReactNode }) {
	return (
		<TrpcProvider>
			{children}
		</TrpcProvider>
	);
}
