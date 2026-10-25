import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
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
export function createSettingsCliDiscovery(basePath: string): {
	publish(address: AddressInfo): Promise<void>;
	close(): void;
} {
	const token = randomBytes(32).toString("hex");
	tokens.add(token);
	const filename = daemonDescriptorPath();
	const cleanup = registerDescriptorExitCleanup(filename, token);
	return {
		async publish(address) {
			const host =
				address.address === "0.0.0.0"
					? "127.0.0.1"
					: address.address === "::"
						? "::1"
						: address.address;
			const descriptor: DaemonDescriptor = {
				pid: process.pid,
				url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}${basePath}/api/trpc`,
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
		},
		close() {
			tokens.delete(token);
			cleanup();
		},
	};
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
