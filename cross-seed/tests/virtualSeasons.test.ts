import {
	mkdtemp,
	mkdir,
	readdir,
	readFile,
	writeFile,
	utimes,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { SearcheeWithLabel } from "../src/searchee.js";

const directory = await mkdtemp(join(tmpdir(), "cross-seed-virtual-seasons-"));
process.env.CONFIG_DIR = directory;
const config = await import("../src/configuration.js");
config.createAppDirHierarchy();
const logging = await import("../src/logger.js");
logging.initializeLogger({});
logging.logger.silent = true;
const { db } = await import("../src/db.js");
const { Action, Decision, InjectionResult, SaveResult } =
	await import("../src/constants.js");
const { Label } = logging;
const { createEnsembleSearchees } = await import("../src/searchee.js");
const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
const episodes: SearcheeWithLabel[] = [];
beforeAll(async () => {
	await db.migrate.latest();
	await mkdir(config.getDefaultRuntimeConfig().outputDir, {
		recursive: true,
	});
	for (let episode = 1; episode <= 3; episode++) {
		const title = `Fictional.Show.S01E0${episode}.1080p.WEB-DL-GROUP`;
		const name = `${title}.mkv`;
		const path = join(directory, name);
		await writeFile(path, Buffer.alloc(100));
		const old = new Date(Date.now() - 10 * 86400000);
		await utimes(path, old, old);
		episodes.push({
			title,
			name,
			path,
			files: [{ name, path: name, length: 100 }],
			length: 100,
			label: Label.SEARCH,
		});
	}
});
afterAll(async () => {
	logging.logger.close();
	await db.destroy();
	delete process.env.CONFIG_DIR;
	await rm(directory, { recursive: true, force: true });
});

it.each([true, false])(
	"only creates injectable virtual seasons when linking is configured (filters=%s)",
	async (useFilters) => {
		for (const [action, linkDirs, count] of [
			[Action.INJECT, [], 0],
			[Action.INJECT, [join(directory, "links")], 1],
			[Action.SAVE, [], 1],
		] as const) {
			setRuntimeConfig({
				...config.getDefaultRuntimeConfig(),
				action,
				linkDirs: [...linkDirs],
				useClientTorrents: false,
			});
			const virtual = await createEnsembleSearchees(episodes, {
				useFilters,
			});
			expect(virtual).toHaveLength(count);
			if (count) expect(virtual[0].files).toHaveLength(3);
		}
	},
);

it("preserves a virtual match as a saved torrent when linking is unavailable", async () => {
	setRuntimeConfig({
		...config.getDefaultRuntimeConfig(),
		action: Action.SAVE,
		useClientTorrents: false,
	});
	const [virtual] = await createEnsembleSearchees(episodes, {
		useFilters: false,
	});
	expect(virtual).toBeDefined();
	const { Metafile } = await import("../src/parseTorrent.js");
	const { buildHybridTorrent } = await import("./support/hybridTorrent.js");
	const meta = Metafile.decode(buildHybridTorrent().torrent);
	setRuntimeConfig({
		...config.getDefaultRuntimeConfig(),
		action: Action.INJECT,
		useClientTorrents: false,
	});
	const { performActionWithoutMutex } = await import("../src/action.js");
	const result = await performActionWithoutMutex(
		meta,
		Decision.MATCH,
		virtual,
		"synthetic",
	);
	expect(result.actionResult).toBe(SaveResult.SAVED);
	expect(result.actionResult).not.toBe(InjectionResult.FAILURE);
	const output = config.getDefaultRuntimeConfig().outputDir;
	const saved = await readdir(output);
	expect(saved).toHaveLength(1);
	expect(
		Metafile.decode(await readFile(join(output, saved[0]))).infoHash,
	).toBe(meta.infoHash);
});
