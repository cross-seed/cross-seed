import { Hono } from "hono";
import type { HttpEnv } from "../httpTypes.js";
import { setSessionCookie } from "../sessionCookies.js";
import { validateSession } from "../userAuth.js";

function isDevLoginEnabled(): boolean {
	return process.env.CROSS_SEED_DEV_LOGIN === "true";
}

function normalizeRedirectTo(redirectTo: unknown): string {
	if (
		typeof redirectTo !== "string" ||
		!redirectTo.startsWith("/") ||
		redirectTo.startsWith("//")
	) {
		return "/";
	}

	return redirectTo;
}

export function devLoginRoutes(basePath: string): Hono<HttpEnv> {
	const app = new Hono<HttpEnv>();
	if (!isDevLoginEnabled()) return app;
	app.get("/api/dev-login/:sessionId", async (c) => {
		const sessionId = c.req.param("sessionId");
		const user = await validateSession(sessionId);
		if (!user) return c.json({ error: "Dev login session not found" }, 404);
		const headers = new Headers({
			Location: `${basePath}${normalizeRedirectTo(c.req.query("redirectTo"))}`,
		});
		setSessionCookie(headers, sessionId);
		return new Response(null, { status: 302, headers });
	});
	return app;
}
