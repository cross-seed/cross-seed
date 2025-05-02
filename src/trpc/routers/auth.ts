import { TRPCError } from "@trpc/server";
import {
	publicProcedure,
	protectedProcedure,
	router,
	loginInputSchema,
	setupInputSchema,
} from "../index.js";
import {
	createSession,
	validateUserCredentials,
	createInitialUserIfNeeded,
	hasUsers,
} from "../../userAuth.js";
import { Label, logger } from "../../logger.js";

export const authRouter = router({
	// Check auth status - similar to rtgc's authStatus
	authStatus: publicProcedure.query(async ({ ctx }) => {
		const hasExistingUsers = await hasUsers();
		return {
			userExists: hasExistingUsers,
			isLoggedIn: !!ctx.user,
			user: ctx.user,
		};
	}),

	// Setup initial admin user
	setup: publicProcedure
		.input(setupInputSchema)
		.mutation(async ({ input, ctx }) => {
			const { username, password } = input;
			const hasExistingUsers = await hasUsers();

			if (hasExistingUsers) {
				logger.warn({
					label: Label.AUTH,
					message: `Setup attempted but users already exist`,
				});

				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Setup has already been completed",
				});
			}

			const user = await createInitialUserIfNeeded(username, password);

			if (!user) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create user",
				});
			}

			const session = await createSession(user.id);
			ctx.setSession(session.id);

			logger.info({
				label: Label.AUTH,
				message: `Initial user created and logged in: ${username}`,
			});
		}),

	// Login with username and password
	logIn: publicProcedure
		.input(loginInputSchema)
		.mutation(async ({ input, ctx }) => {
			const { username, password } = input;
			const user = await validateUserCredentials(username, password);

			if (!user) {
				logger.warn({
					label: Label.AUTH,
					message: `Failed login attempt for username: ${username}`,
				});

				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const session = await createSession(user.id);
			ctx.setSession(session.id);

			logger.info({
				label: Label.AUTH,
				message: `User logged in: ${username}`,
			});
		}),

	// Logout current user
	logOut: publicProcedure.mutation(async ({ ctx }) => {
		ctx.deleteSession();

		logger.info({
			label: Label.AUTH,
			message: `User logged out`,
		});
	}),

	// Protected route example - only accessible when logged in
	getProtectedData: protectedProcedure.query(({ ctx }) => {
		return {
			message: `Hello, ${ctx.user.username}! This is protected data.`,
		};
	}),
});
