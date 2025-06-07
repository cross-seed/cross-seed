import { TRPCError } from "@trpc/server";
import {
	unauthedProcedure,
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
	authStatus: unauthedProcedure.query(async ({ ctx }) => {
		const hasExistingUsers = await hasUsers();
		return {
			userExists: hasExistingUsers,
			isLoggedIn: !!ctx.user,
			user: ctx.user,
		};
	}),

	// Setup initial admin user
	setup: unauthedProcedure
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
	logIn: unauthedProcedure
		.input(loginInputSchema)
		.mutation(async ({ input, ctx }) => {
			const { username, password } = input;

			// Check if there are any users - if not, create the first user
			const hasExistingUsers = await hasUsers();
			if (!hasExistingUsers) {
				logger.info({
					label: Label.AUTH,
					message: `No users exist, creating initial user: ${username}`,
				});

				const newUser = await createInitialUserIfNeeded(
					username,
					password,
				);
				if (newUser) {
					const session = await createSession(newUser.id);
					ctx.setSession(session.id);

					logger.info({
						label: Label.AUTH,
						message: `Initial user created and logged in: ${username}`,
					});
					return;
				}
			}

			// Normal authentication flow
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

	logOut: unauthedProcedure.mutation(async ({ ctx }) => {
		ctx.deleteSession();

		logger.info({
			label: Label.AUTH,
			message: `User logged out`,
		});
	}),
});
