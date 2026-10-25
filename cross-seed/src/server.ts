import {
	registerSettingsCliDiscovery,
	publishDisabledSettingsCli,
} from "./configDaemonDiscovery.js";
import fastifyCookie from "@fastify/cookie";
import fastify, { FastifyInstance } from "fastify";
import { Label, logger } from "./logger.js";
import { baseApiPlugin } from "./routes/baseApi.js";
import { devLoginPlugin } from "./routes/devLogin.js";
import { staticFrontendPlugin } from "./routes/staticFrontendPlugin.js";
import { appTrpcPlugin } from "./trpc/fastifyAdapter.js";

async function apiPlugin(app: FastifyInstance) {
	await app.register(appTrpcPlugin, { prefix: "/trpc" });
	await app.register(baseApiPlugin);
}

async function rootPlugin(
	app: FastifyInstance,
	{ basePath }: { basePath: string },
) {
	await app.register(fastifyCookie);
	await app.register(devLoginPlugin, { basePath });
	await app.register(apiPlugin, { prefix: "/api" });
	await app.register(staticFrontendPlugin, { basePath });
}

export async function createServer(
	basePath: string,
): Promise<{ app: FastifyInstance; cliReady: Promise<void> }> {
	const app = fastify({ logger: false });
	const cliReady = registerSettingsCliDiscovery(app, basePath);
	if (basePath) {
		await app.register(rootPlugin, { prefix: basePath, basePath });
		app.get("*", async (request, reply) => {
			return reply.redirect(`${basePath}/`);
		});
	} else {
		await app.register(rootPlugin, { basePath: "" });
	}

	return { app, cliReady };
}

/**
 * Listens (daemon) on configured port for http API calls
 */
export async function serve(
	port = 2468,
	host = "0.0.0.0",
	basePath = "",
	onListening?: () => void,
): Promise<void> {
	if (!port) {
		await publishDisabledSettingsCli();
		onListening?.();
		return;
	}
	const { app: server, cliReady } = await createServer(basePath);

	return new Promise((resolve, reject) => {
		server.listen({ port, host }, (err) => {
			if (err) {
				logger.error({
					label: Label.SERVER,
					message: `Failed to start server: ${err.message}`,
				});
				process.exit(1);
			}
			void cliReady
				.then(() => {
					logger.info({
						label: Label.SERVER,
						message: `Server is running on port ${port}, ^C to stop.`,
					});
					onListening?.();
				})
				.catch((error: unknown) => {
					logger.error({
						label: Label.SERVER,
						message: `Unable to publish local CLI discovery: ${String(error)}`,
					});
					reject(
						error instanceof Error
							? error
							: new Error(String(error)),
					);
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
