import { FastifyReply, FastifyRequest } from "fastify";
import { validateSession } from "./userAuth.js";

const COOKIE_NAME = "cross_seed_session";
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: process.env.NODE_ENV === "production", // Only set secure in production
	maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds (match session expiry)
	path: "/",
	sameSite: "lax" as const,
};

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
	reply.setCookie(COOKIE_NAME, sessionId, COOKIE_OPTIONS);
}

export function clearSessionCookie(reply: FastifyReply): void {
	reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getSessionCookie(request: FastifyRequest): string | undefined {
	return request.cookies[COOKIE_NAME];
}

export async function validateAuth(request: FastifyRequest): Promise<boolean> {
	const sessionId = getSessionCookie(request);

	if (!sessionId) {
		return false;
	}

	const user = await validateSession(sessionId);
	return !!user;
}
