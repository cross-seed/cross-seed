import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";

const SALT_ROUNDS = 10;
const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

export interface User {
	id: number;
	username: string;
	password: string;
	created_at: Date;
}

export interface Session {
	id: string;
	user_id: number;
	expires_at: number;
	created_at: number;
}

export async function createUser(
	username: string,
	password: string,
): Promise<User> {
	const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

	const [user] = await db("user")
		.insert({
			username,
			password: hashedPassword,
		})
		.returning("*");

	logger.info({
		label: Label.AUTH,
		message: `Created user: ${username}`,
	});

	return user;
}

export async function findUserByUsername(
	username: string,
): Promise<User | undefined> {
	return db("user").where({ username }).first();
}

export async function validateUserCredentials(
	username: string,
	password: string,
): Promise<User | null> {
	const user = await findUserByUsername(username);

	if (!user) {
		return null;
	}

	const isValid = await bcrypt.compare(password, user.password);
	return isValid ? user : null;
}

export async function createSession(userId: number): Promise<Session> {
	const sessionId = randomBytes(32).toString("hex");
	const now = Date.now();
	const expiresAt = now + SESSION_EXPIRY;

	const session = {
		id: sessionId,
		user_id: userId,
		expires_at: expiresAt,
		created_at: now,
	};

	await db("session").insert(session);

	return session;
}

export async function validateSession(sessionId: string): Promise<User | null> {
	const session = await db("session")
		.where({
			id: sessionId,
		})
		.where("expires_at", ">", Date.now())
		.first();

	if (!session) {
		return null;
	}

	const user = await db("user").where({ id: session.user_id }).first();

	return user || null;
}

export async function removeSession(sessionId: string): Promise<void> {
	await db("session").where({ id: sessionId }).delete();
}

export async function hasUsers(): Promise<boolean> {
	const count = await db("user").count("* as count").first();
	return (count?.count as number) > 0;
}

export async function createInitialUserIfNeeded(
	username: string,
	password: string,
): Promise<User | null> {
	const hasExistingUsers = await hasUsers();

	if (hasExistingUsers) {
		logger.info({
			label: Label.AUTH,
			message: "Initial user already exists, skipping creation",
		});
		return null;
	}

	logger.info({
		label: Label.AUTH,
		message: "Creating initial user",
	});

	return createUser(username, password);
}
