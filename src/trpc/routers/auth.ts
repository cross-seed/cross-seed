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

const SIGNUP_WINDOW_MS = 5 * 60 * 1000;
const signupWindowStart = Date.now();

function getSignupWindowMsRemaining(): number {
	const elapsedMs = Date.now() - signupWindowStart;
	return Math.max(0, SIGNUP_WINDOW_MS - elapsedMs);
}

function isSignupWindowOpen(): boolean {
	return getSignupWindowMsRemaining() > 0;
}

export const authRouter = router({
	// Check auth status - similar to rtgc's authStatus
	authStatus: unauthedProcedure.query(async ({ ctx }) => {
		const hasExistingUsers = await hasUsers();
		return {
			userExists: hasExistingUsers,
			signupAllowed: !hasExistingUsers && isSignupWindowOpen(),
			signupWindowMsRemaining: getSignupWindowMsRemaining(),
			isDocker: process.env.DOCKER_ENV === "true",
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

			if (!isSignupWindowOpen()) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Initial setup window has expired. Restart cross-seed to create the first user.",
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
				if (!isSignupWindowOpen()) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message:
							"Initial setup window has expired. Restart cross-seed to create the first user.",
					});
				}

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
