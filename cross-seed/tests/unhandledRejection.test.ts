import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("startup preserves Node's unhandled rejection policy", async () => {
	const previousConfigDir = process.env.CONFIG_DIR;
	const configDir = await mkdtemp(join(tmpdir(), "cross-seed-rejections-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();
	const listeners = process.listeners("unhandledRejection");
	try {
		const { createAppDirHierarchy } =
			await import("../src/configuration.js");
		createAppDirHierarchy();
		const { initializeLogger } = await import("../src/logger.js");
		initializeLogger({ verbose: false });
		const { exitGracefully } = await import("../src/startup.js");
		try {
			expect(process.listeners("unhandledRejection")).toEqual(listeners);
		} finally {
			process.removeListener("SIGINT", exitGracefully);
			process.removeListener("SIGTERM", exitGracefully);
			const { db } = await import("../src/db.js");
			await db.destroy();
		}
	} finally {
		if (previousConfigDir === undefined) delete process.env.CONFIG_DIR;
		else process.env.CONFIG_DIR = previousConfigDir;
		await rm(configDir, { recursive: true, force: true });
	}
});
