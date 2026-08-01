import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe.sequential("unhandled rejection guard", () => {
	afterEach(() => {
		delete process.env.CONFIG_DIR;
	});

	it("registers a listener that logs instead of letting the daemon crash", async () => {
		const configDir = await mkdtemp(
			join(tmpdir(), "cross-seed-unhandled-rejection-tests-"),
		);
		process.env.CONFIG_DIR = configDir;
		vi.resetModules();

		const { createAppDirHierarchy } =
			await import("../src/configuration.js");
		const loggerModule = await import("../src/logger.js");
		createAppDirHierarchy();
		loggerModule.initializeLogger({ verbose: false });

		await import("../src/startup.js");

		const listeners = process.listeners("unhandledRejection");
		expect(listeners.length).toBeGreaterThan(0);

		const errorSpy = vi
			.spyOn(loggerModule.logger, "error")
			.mockImplementation(() => loggerModule.logger);

		// simulates the real-world trigger: a fire-and-forget background
		// call (e.g. `void this.resumeInjection(...)`) rejecting with no
		// attached .catch()
		const reason = new Error("simulated: socket other side closed");
		for (const listener of listeners) {
			listener(
				reason,
				Promise.reject(reason).catch(() => {}),
			);
		}

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
