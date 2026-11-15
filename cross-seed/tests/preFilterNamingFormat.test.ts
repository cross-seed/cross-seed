import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { fileFactory } from "./factories/file.js";
import { searcheeFactory } from "./factories/searchee.js";
import type { SearcheeLabel, SearcheeWithLabel } from "../src/searchee.js";

// CONFIG_DIR must exist before src/db.ts is first evaluated, so the modules
// that depend on it are imported dynamically after it is set.
const directory = await mkdtemp(join(tmpdir(), "cross-seed-prefilter-"));
process.env.CONFIG_DIR = directory;
const config = await import("../src/configuration.js");
config.createAppDirHierarchy();
const logging = await import("../src/logger.js");
logging.initializeLogger({});
logging.logger.silent = true;
const { db } = await import("../src/db.js");
const { filterByContent } = await import("../src/preFilter.js");
const { Label } = logging;

afterAll(async () => {
	logging.logger.close();
	await db.destroy();
});

function namedSearchee(title: string, label: SearcheeLabel): SearcheeWithLabel {
	return {
		...searcheeFactory({
			title,
			name: title,
			infoHash: "a".repeat(40),
			files: [fileFactory({ name: `${title}.mkv`, length: 100 })],
			length: 100,
		}),
		label,
	};
}

function filterOptions() {
	return {
		configOverride: {
			blockList: [],
			includeNonVideos: true,
			includeSingleEpisodes: true,
		},
		allowSeasonPackEpisodes: true,
		ignoreCrossSeeds: false,
	};
}

describe("preFilter non-standard season naming", () => {
	it("searches for a release with an S<digits> group tag", async () => {
		const title = "voices38-star.wars.galactic.racer";
		const labels: SearcheeLabel[] = [Label.WEBHOOK, Label.SEARCH];
		for (const label of labels) {
			const filtered = await filterByContent(
				namedSearchee(title, label),
				filterOptions(),
			);
			expect(filtered).toBe(true);
		}
	});

	it("filters titles that begin with a season marker", async () => {
		const verbose = vi.spyOn(logging.logger, "verbose");
		try {
			for (const title of ["S03", "S01.1080p", "Season 2 Complete"]) {
				const filtered = await filterByContent(
					namedSearchee(title, Label.SEARCH),
					filterOptions(),
				);
				expect(filtered).toBe(false);
			}
			expect(
				verbose.mock.calls.some(
					([entry]) =>
						"message" in entry &&
						String(entry.message).includes(
							"non-standard episode/season naming format",
						),
				),
			).toBe(true);
		} finally {
			verbose.mockRestore();
		}
	});

	it("does not filter standard season packs or episodes", async () => {
		for (const title of [
			"My.Show.S02.1080p",
			"My.Show.S01E01.1080p",
			"My Show 2019",
		]) {
			const filtered = await filterByContent(
				namedSearchee(title, Label.SEARCH),
				filterOptions(),
			);
			expect(filtered).toBe(true);
		}
	});
});
