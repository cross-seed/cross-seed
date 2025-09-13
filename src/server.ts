import fastifyCookie from "@fastify/cookie";
import fastify, { FastifyInstance } from "fastify";
import { Label, logger } from "./logger.js";
import { baseApiPlugin } from "./routes/baseApi.js";
import { indexerApiPlugin } from "./routes/indexerApi.js";
import { staticFrontendPlugin } from "./routes/staticFrontendPlugin.js";
import { appTrpcPlugin } from "./trpc/fastifyAdapter.js";

async function apiPlugin(app: FastifyInstance) {
	await app.register(appTrpcPlugin, { prefix: "/trpc" });
	await app.register(indexerApiPlugin, { prefix: "/indexer/v1" });
	await app.register(baseApiPlugin);
}

async function rootPlugin(app: FastifyInstance) {
	await app.register(fastifyCookie);
	await app.register(apiPlugin, { prefix: "/api" });
	await app.register(staticFrontendPlugin);
}

async function createServer(basePath: string): Promise<FastifyInstance> {
	const app = fastify({ logger: false });
	if (basePath) {
		await app.register(rootPlugin, { prefix: basePath });
		app.get("*", async (request, reply) => {
			return reply.redirect(`${basePath}/`);
		});
	} else {
		await app.register(rootPlugin);
	}
	return app;
}

/**
 * Listens (daemon) on configured port for http API calls
 */
export async function serve(
	port = 2468,
	host = "0.0.0.0",
	basePath = "",
): Promise<void> {
	if (!port) return;
	const server = await createServer(basePath);

	return new Promise((resolve) => {
		server.listen({ port, host }, (err) => {
			if (err) {
				logger.error({
					label: Label.SERVER,
					message: `Failed to start server: ${err.message}`,
				});
				process.exit(1);
			}
			logger.info({
				label: Label.SERVER,
				message: `Server is running on port ${port}, ^C to stop.`,
			});
		});

		function stop() {
			server.close(() => {
				logger.info({
					label: Label.SERVER,
					message: "Server stopped",
				});
				resolve();
			});
		}

		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}
