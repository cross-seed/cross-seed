import { randomBytes } from "node:crypto";
import { CrossSeedError } from "./errors.js";
import { db } from "./db.js";
import {
	createSession,
	createUser,
	findUserByUsername,
	hasUsers,
	type User,
} from "./userAuth.js";

const DEFAULT_ORIGIN = "http://localhost:2468";
const DEFAULT_REDIRECT_TO = "/settings/general";

function normalizeOrigin(origin: string): string {
	try {
		return new URL(origin).origin;
	} catch {
		throw new CrossSeedError(`Invalid --origin: ${origin}`);
	}
}

function normalizeRedirectTo(redirectTo: string): string {
	if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
		throw new CrossSeedError("--redirect-to must be a local absolute path");
	}

	return redirectTo;
}

type DevLoginOptions = {
	origin?: string;
	redirectTo?: string;
	user?: string;
};

export async function createDevLogin(
	options: DevLoginOptions = {},
): Promise<string> {
	const origin = normalizeOrigin(options.origin ?? DEFAULT_ORIGIN);
	const redirectTo = normalizeRedirectTo(
		options.redirectTo ?? DEFAULT_REDIRECT_TO,
	);
	const requestedUsername = options.user?.trim();

	let user: User | undefined = requestedUsername
		? await findUserByUsername(requestedUsername)
		: await db<User>("user").first();

	if (!user) {
		if (await hasUsers()) {
			throw new CrossSeedError(
				requestedUsername
					? `User not found: ${requestedUsername}`
					: "No user found",
			);
		}

		user = await createUser(
			requestedUsername || "dev",
			randomBytes(24).toString("hex"),
		);
	}

	const session = await createSession(user.id);
	const url = new URL(`/api/dev-login/${session.id}`, origin);
	url.searchParams.set("redirectTo", redirectTo);

	return [
		`Dev login created for ${user.username}`,
		`Open: ${url.toString()}`,
		`Cookie: cross-seed-session=${session.id}`,
	].join("\n");
}
