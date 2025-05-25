import {
	fastifyTRPCPlugin,
	FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { FastifyInstance } from "fastify";
import { appRouter } from "./routers/index.js";
import { createContext } from "./index.js";

export async function registerTRPC(app: FastifyInstance) {
	// Register the tRPC plugin with Fastify
	void app.register(fastifyTRPCPlugin, {
		prefix: "/api/trpc",
		trpcOptions: {
			router: appRouter,
			createContext,
		},
	} as FastifyTRPCPluginOptions<typeof appRouter>);
}
