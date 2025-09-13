import {
	fastifyTRPCPlugin,
	FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { FastifyInstance } from "fastify";
import { createContext } from "./index.js";
import { appRouter } from "./routers/index.js";

export async function appTrpcPlugin(app: FastifyInstance) {
	await app.register(fastifyTRPCPlugin, {
		trpcOptions: { router: appRouter, createContext },
	} as FastifyTRPCPluginOptions<typeof appRouter>);
}
