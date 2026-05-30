import { FastifyInstance } from "fastify";
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

// eslint-disable-next-line @typescript-eslint/require-await
export async function devLoginPlugin(
	app: FastifyInstance,
	{ basePath }: { basePath: string },
) {
	if (!isDevLoginEnabled()) return;

	app.get<{
		Params: { sessionId: string };
		Querystring: { redirectTo?: string };
	}>("/api/dev-login/:sessionId", async (request, reply) => {
		const sessionId = request.params.sessionId;
		const user = await validateSession(sessionId);
		if (!user) {
			return reply
				.code(404)
				.send({ error: "Dev login session not found" });
		}

		setSessionCookie(reply, sessionId);
		return reply.redirect(
			`${basePath}${normalizeRedirectTo(request.query.redirectTo)}`,
		);
	});
}
