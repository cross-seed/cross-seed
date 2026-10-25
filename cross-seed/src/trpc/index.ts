import { daemonSettingsService } from "../daemonSettings.js";
import type { SettingsService } from "../settingsService.js";
import { validSettingsCliToken } from "../configDaemonDiscovery.js";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { validateSession } from "../userAuth.js";
import {
	getSessionCookie,
	setSessionCookie,
	clearSessionCookie,
} from "../sessionCookies.js";
import { Label, logger } from "../logger.js";
import { z } from "zod";

// Create context type for tRPC
type AuthenticatedUser = {
	id: number;
	username: string;
};

export interface Context {
	settingsService?: SettingsService;
	req: Request;
	res: Headers;
	user: AuthenticatedUser | null;
	setSession: (sessionId: string) => void;
	deleteSession: () => void;
}

// Context creator function
export async function createContext({
	req,
	resHeaders,
}: FetchCreateContextFnOptions): Promise<Context> {
	const sessionId = getSessionCookie(req);

	let user: AuthenticatedUser | null = null;
	if (sessionId) {
		// Validate the session and get user if valid
		const validatedUser = await validateSession(sessionId);
		if (validatedUser) {
			user = {
				id: validatedUser.id,
				username: validatedUser.username,
			};
		}
	}

	return {
		settingsService:
			user ||
			validSettingsCliToken(req.headers.get("authorization") ?? undefined)
				? daemonSettingsService
				: undefined,
		req,
		res: resHeaders,
		user,
		setSession: (sessionId: string) =>
			setSessionCookie(resHeaders, sessionId),
		deleteSession: () => clearSessionCookie(resHeaders),
	};
}

// Initialize tRPC
const t = initTRPC.context<Context>().create();

// Base router and procedure helpers
export const router = t.router;
export const unauthedProcedure = t.procedure;

// Procedure that requires authentication
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.user) {
		logger.warn({
			label: Label.AUTH,
			message: `Unauthorized access attempt to protected procedure`,
		});

		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	return next({ ctx: { ...ctx, user: ctx.user } });
});

// Input validators
export const loginInputSchema = z.object({
	username: z.string().min(1, "Username is required"),
	password: z.string().min(1, "Password is required"),
});

export const setupInputSchema = z.object({
	username: z.string().min(1, "Username is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});
