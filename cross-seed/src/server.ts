import { getRequestListener } from "@hono/node-server";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createServer as createNodeServer } from "node:http";
import type { AddressInfo, ListenOptions } from "node:net";
import {
	createSettingsCliDiscovery,
	publishDisabledSettingsCli,
} from "./configDaemonDiscovery.js";
import type { HttpEnv } from "./httpTypes.js";
import { Label, logger } from "./logger.js";
import { baseApiRoutes } from "./routes/baseApi.js";
import { devLoginRoutes } from "./routes/devLogin.js";
import { serveFrontend } from "./routes/staticFrontendPlugin.js";
import { handleTrpcRequest } from "./trpc/fetchAdapter.js";
import { errorMessage } from "./utils.js";
import { runInBackground } from "./utils/background.js";
import { registerShutdownHook } from "./utils/shutdown.js";

// The Node adapter's Request-shaped object is not a native Request. Copy its
// fields before middleware (including bodyLimit) attempts to clone it.
function copyRequest(incoming: Request, signal = incoming.signal): Request {
	const init = {
		method: incoming.method,
		headers: incoming.headers,
		body:
			incoming.method === "GET" || incoming.method === "HEAD"
				? undefined
				: incoming.body,
		signal,
		duplex: "half",
	};
	return new Request(incoming.url, init);
}

export function createHttpApp(
	basePath = "",
	options: {
		trackBackground?: (task: Promise<void>) => void;
		signal?: AbortSignal;
	} = {},
): Hono<HttpEnv> {
	const app = new Hono<HttpEnv>();
	const integrationPaths = new Set(
		["ping", "webhook", "announce"].map(
			(name) => `${basePath}/api/${name}`,
		),
	);
	const integrationCors = cors({
		origin: "*",
		allowMethods: ["GET", "HEAD", "POST"],
	});
	// Run before parsing/limits so browser integrations can read error responses.
	app.use("*", async (c: Context<HttpEnv, string>, next: Next) => {
		if (!integrationPaths.has(c.req.path)) {
			await next();
			return;
		}
		if (
			c.req.method === "OPTIONS" &&
			(!c.req.header("origin") ||
				!c.req.header("access-control-request-method"))
		) {
			return c.text("Invalid Preflight Request", 400);
		}
		return integrationCors(c, next);
	});

	app.use(
		"*",
		bodyLimit({
			maxSize: 1024 * 1024,
			onError: (c) =>
				c.json(
					{
						statusCode: 413,
						code: "FST_ERR_CTP_BODY_TOO_LARGE",
						error: "Payload Too Large",
						message: "Request body is too large",
					},
					413,
				),
		}),
	);
	app.onError((error, c) => {
		logger.error({ label: Label.SERVER, message: errorMessage(error) });
		return c.json(
			{
				statusCode: 500,
				error: "Internal Server Error",
				message: errorMessage(error),
			},
			500,
		);
	});
	const endpoint = `${basePath}/api/trpc`;
	app.all(`${endpoint}/*`, (c) => {
		const incoming = c.req.raw;
		const signal = options.signal
			? AbortSignal.any([incoming.signal, options.signal])
			: incoming.signal;
		return handleTrpcRequest(copyRequest(incoming, signal), endpoint);
	});
	app.route(basePath || "/", devLoginRoutes(basePath));
	app.route(`${basePath}/api`, baseApiRoutes(options.trackBackground));
	if (basePath) app.get(basePath, (c) => serveFrontend(c, basePath));
	app.get(`${basePath}/*`, (c) => serveFrontend(c, basePath));
	if (basePath) app.get("*", (c) => c.redirect(`${basePath}/`, 302));
	// Preserve the JSON 404 shape for unmatched non-GET requests.
	app.notFound((c) =>
		c.json(
			{
				message: `Route ${c.req.method}:${c.req.path}${new URL(c.req.url).search} not found`,
				error: "Not Found",
				statusCode: 404,
			},
			404,
		),
	);
	return app;
}

export function createServer(basePath = "") {
	const pending = new Set<Promise<void>>();
	function trackBackground(task: Promise<void>) {
		const tracked = task.finally(() => pending.delete(tracked));
		pending.add(tracked);
		runInBackground(tracked);
	}
	const shutdown = new AbortController();
	const app = createHttpApp(basePath, {
		trackBackground,
		signal: shutdown.signal,
	});
	const listener = getRequestListener(
		(incoming, bindings: HttpEnv["Bindings"]) =>
			app.fetch(
				incoming.body ? copyRequest(incoming) : incoming,
				bindings,
			),
		{ overrideGlobalObjects: false },
	);
	const server = createNodeServer((req, res) => {
		runInBackground(Promise.resolve(listener(req, res)));
	});
	let discovery: ReturnType<typeof createSettingsCliDiscovery> | undefined;
	let closing: Promise<void> | undefined;
	let resolveClosed!: () => void;
	const closed = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const unregister = registerShutdownHook(close);
	async function close() {
		closing ??= (async () => {
			shutdown.abort();
			try {
				await new Promise<void>((resolve, reject) => {
					if (!server.listening) {
						resolve();
						return;
					}
					server.close((error) =>
						error ? reject(error) : resolve(),
					);
				});
				await Promise.allSettled(pending);
			} finally {
				discovery?.close();
				unregister();
				resolveClosed();
			}
		})();
		return closing;
	}
	async function listen(options: ListenOptions) {
		discovery = createSettingsCliDiscovery(basePath);
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(options, () => {
					server.removeListener("error", reject);
					resolve();
				});
			});
			await discovery.publish(server.address() as AddressInfo);
		} catch (error) {
			await close();
			throw error;
		}
	}
	return { app, server, listen, close, closed };
}

export type HttpServer = ReturnType<typeof createServer>;

/** Serve until shutdown, publishing CLI discovery before reporting readiness. */
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
	const server = createServer(basePath);
	await server.listen({ port, host });
	logger.info({
		label: Label.SERVER,
		message: `Server is running on port ${port}, ^C to stop.`,
	});
	try {
		onListening?.();
		await server.closed;
		logger.info({ label: Label.SERVER, message: "Server stopped" });
	} finally {
		await server.close();
	}
}
