# TanStack App Integration Options

This document outlines options for integrating the TanStack-based frontend with
different server setups.

## Option 1: Standalone TanStack App

The default setup uses Vinxi to handle both client and server rendering:

```bash
# From the client directory
npm run dev   # Development mode
npm run build # Production build
npm run start # Serve production build
```

## Option 2: Integration with Fastify (SPA Mode)

For integrating as a Single Page Application without SSR:

1. **Extract TRPC Router:**

    ```typescript
    // In your Fastify project
    import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
    import { trpcRouter } from "./path/to/trpc/router";

    // Register TRPC with Fastify
    app.register(fastifyTRPCPlugin, {
    	prefix: "/api/trpc",
    	trpcOptions: { router: trpcRouter },
    });
    ```

2. **Serve Static Assets:**

    ```typescript
    // Build the client app
    // npm run build (from client directory)

    // In your Fastify project
    import fastifyStatic from "fastify-static";
    import path from "path";

    // Serve static assets
    app.register(fastifyStatic, {
    	root: path.join(__dirname, "path/to/client/dist"),
    	prefix: "/",
    });

    // Catch-all route for SPA routing
    app.get("*", (request, reply) => {
    	reply.sendFile("index.html");
    });
    ```

3. **Modify Client Entry:**

    ```typescript
    // client.tsx
    import { StartClient } from "@tanstack/react-start";
    import { createRoot } from "react-dom/client";
    import { createRouter } from "./router";

    const router = createRouter();
    const rootElement = document.getElementById('root');
    createRoot(rootElement).render(<StartClient router={router} />);
    ```

## Option 3: Integration with Fastify (SSR Mode)

For server-side rendering with Fastify:

1. **Create SSR Plugin:**

    ```typescript
    // ssr-plugin.ts
    import { FastifyPluginAsync } from "fastify";
    import { getRouterManifest } from "@tanstack/react-start/router-manifest";
    import {
    	createStartHandler,
    	defaultStreamHandler,
    } from "@tanstack/react-start/server";
    import { createRouter } from "./path/to/client/src/router";

    // Custom handler for Fastify
    const fastifyStreamHandler = (ctx) => {
    	const { req, res } = ctx.fastifyRequest.raw;
    	return defaultStreamHandler({ ...ctx, req, res });
    };

    const ssrHandler = createStartHandler({
    	createRouter,
    	getRouterManifest,
    })(fastifyStreamHandler);

    export const ssrPlugin: FastifyPluginAsync = async (fastify) => {
    	// Handle API requests through TRPC
    	fastify.register(trpcPlugin);

    	// Handle page requests with SSR
    	fastify.get("*", async (request, reply) => {
    		return ssrHandler({
    			request: request.raw,
    			fastifyRequest: request,
    		});
    	});
    };
    ```

2. **Register with Fastify:**

    ```typescript
    import fastify from "fastify";
    import { ssrPlugin } from "./ssr-plugin";

    const app = fastify();

    // Register the SSR plugin
    app.register(ssrPlugin);

    // Start the server
    app.listen({ port: 3000 });
    ```

## Required Dependencies

For both integration options:

```bash
npm install @trpc/server @trpc/client superjson
```

For SSR integration, also add:

```bash
npm install @tanstack/react-start @tanstack/react-router @tanstack/react-router-with-query
```

## Development Workflow

1. Develop the frontend components in the client directory using `npm run dev`
2. When ready to integrate, build the client app with `npm run build`
3. Configure your Fastify server to either:
    - Serve the static assets (SPA mode)
    - Process requests through the SSR handler (SSR mode)

## Notes

-   Update TRPC client configuration to point to your Fastify endpoint
-   Adjust paths in the examples based on your project structure
-   Consider bundling the client build artifacts with your server deployment
