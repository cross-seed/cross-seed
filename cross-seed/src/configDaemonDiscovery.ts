import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { appDir } from "./configuration.js";

export interface DaemonDescriptor {
	pid: number;
	url: string | null;
	token: string;
}

export function daemonDescriptorPath(): string {
	return join(appDir(), "daemon.json");
}

/** A private, per-process capability for local CLI settings commands. */
export function registerSettingsCliDiscovery(
	app: FastifyInstance,
	basePath: string,
): Promise<void> {
	const token = randomBytes(32).toString("hex");
	tokens.add(token);
	const filename = daemonDescriptorPath();
	const exitCleanup = registerDescriptorExitCleanup(filename, token);
	const path = `${basePath}/api/trpc`;
	let publish: Promise<void> = Promise.resolve();
	let readyResolve!: () => void;
	let readyReject!: (error: unknown) => void;
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	// A caller can await readiness after listen resolves without a transient
	// unhandled rejection if publication fails in the meantime.
	void ready.catch(() => undefined);
	app.addHook("onListen", async () => {
		publish = (async () => {
			const address = app.server.address() as AddressInfo;
			const host =
				address.address === "0.0.0.0"
					? "127.0.0.1"
					: address.address === "::"
						? "::1"
						: address.address;
			const descriptor: DaemonDescriptor = {
				pid: process.pid,
				url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}${path}`,
				token,
			};
			const temporary = `${filename}.${token}.tmp`;
			try {
				await writeFile(temporary, JSON.stringify(descriptor), {
					mode: 0o600,
					flag: "wx",
				});
				await rename(temporary, filename);
			} finally {
				await unlink(temporary).catch(() => undefined);
			}
		})();
		try {
			await publish;
			readyResolve();
		} catch (error) {
			// Fastify logs and ignores onListen errors. Explicitly stop serving so
			// CLI commands cannot mistake an undiscoverable daemon for offline.
			try {
				await app.close();
			} finally {
				readyReject(error);
			}
		}
	});
	app.addHook("onClose", async () => {
		tokens.delete(token);
		await publish.catch(() => undefined);
		exitCleanup();
	});
	return ready;
}

const tokens = new Set<string>();

export function validSettingsCliToken(
	authorization: string | undefined,
): boolean {
	const supplied = Buffer.from(authorization ?? "");
	for (const token of tokens) {
		const expected = Buffer.from(`Bearer ${token}`);
		if (
			supplied.length === expected.length &&
			timingSafeEqual(supplied, expected)
		)
			return true;
	}
	return false;
}

/** Advertise a live daemon even when its HTTP API is explicitly disabled. */
export async function publishDisabledSettingsCli(): Promise<() => void> {
	const token = randomBytes(32).toString("hex");
	const filename = daemonDescriptorPath();
	const temporary = `${filename}.${token}.tmp`;
	const descriptor: DaemonDescriptor = { pid: process.pid, url: null, token };
	try {
		await writeFile(temporary, JSON.stringify(descriptor), {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, filename);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	return registerDescriptorExitCleanup(filename, token);
}

function registerDescriptorExitCleanup(
	filename: string,
	token: string,
): () => void {
	const cleanup = () => {
		process.removeListener("exit", cleanup);
		try {
			const current = JSON.parse(
				readFileSync(filename, "utf8"),
			) as DaemonDescriptor;
			if (current.token === token) unlinkSync(filename);
		} catch {
			/* A missing or replaced descriptor does not belong to us. */
		}
	};
	process.once("exit", cleanup);
	return cleanup;
}
