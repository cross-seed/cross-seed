import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Application imports initialize SQLite. Give each test file its own directory
// before those imports run, including when CONFIG_DIR points to a real install.
const previousConfigDir = process.env.CONFIG_DIR;
const directory = await mkdtemp(join(tmpdir(), "cross-seed-test-"));
process.env.CONFIG_DIR = directory;

afterAll(async () => {
	if (previousConfigDir === undefined) {
		delete process.env.CONFIG_DIR;
	} else {
		process.env.CONFIG_DIR = previousConfigDir;
	}
	await rm(directory, { recursive: true, force: true });
});
