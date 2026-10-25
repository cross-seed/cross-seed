import { parse, serialize } from "hono/utils/cookie";
import { validateSession } from "./userAuth.js";

const COOKIE_NAME = "cross-seed-session";

export function setSessionCookie(headers: Headers, sessionId: string): void {
	headers.append(
		"Set-Cookie",
		serialize(COOKIE_NAME, sessionId, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			maxAge: 30 * 24 * 60 * 60,
			path: "/",
			sameSite: "lax",
		}),
	);
}

export function clearSessionCookie(headers: Headers): void {
	headers.append(
		"Set-Cookie",
		serialize(COOKIE_NAME, "", {
			path: "/",
			maxAge: 0,
			expires: new Date(0),
		}),
	);
}

export function getSessionCookie(request: Request): string | undefined {
	return parse(request.headers.get("cookie") ?? "")[COOKIE_NAME];
}

export async function validateAuth(request: Request): Promise<boolean> {
	const sessionId = getSessionCookie(request);
	return !!sessionId && !!(await validateSession(sessionId));
}
