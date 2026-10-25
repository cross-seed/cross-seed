import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "./index.js";
import { appRouter } from "./routers/index.js";

export function handleTrpcRequest(
	req: Request,
	endpoint: string,
): Promise<Response> {
	return fetchRequestHandler({
		req,
		endpoint,
		router: appRouter,
		createContext,
	});
}
