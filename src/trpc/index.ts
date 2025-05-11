import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { validateSession } from "../userAuth.js";
import {
	getSessionCookie,
	setSessionCookie,
	clearSessionCookie,
} from "../sessionCookies.js";
import { Label, logger } from "../logger.js";
import { z } from "zod";

// Create context type for tRPC
export interface Context {
	req: CreateFastifyContextOptions["req"];
	res: CreateFastifyContextOptions["res"];
	user: { id: number; username: string } | null;
	setSession: (sessionId: string) => void;
	deleteSession: () => void;
}

// Context creator function
export async function createContext({
	req,
	res,
}: CreateFastifyContextOptions): Promise<Context> {
	const sessionId = getSessionCookie(req);

	let user = null;
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
		req,
		res,
		user,
		setSession: (sessionId: string) => setSessionCookie(res, sessionId),
		deleteSession: () => clearSessionCookie(res),
	};
}

// Initialize tRPC
const t = initTRPC.context<Context>().create();

// Base router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;

// Procedure that requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
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
