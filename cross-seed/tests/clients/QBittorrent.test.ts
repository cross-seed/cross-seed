import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = {
	categoryTemplate: undefined as string | undefined,
	tagsTemplate: undefined as string[] | undefined,
	duplicateCategories: false,
	linkCategory: "cross-seed-link",
};

vi.mock("../../src/runtimeConfig.js", () => ({
	getRuntimeConfig: () => mockConfig,
}));

type TemplateMethods = {
	getCategoryForNewTorrent(
		category: string,
		savePath: string,
		autoTMM: boolean,
		searcheeInfo?: { category: string },
	): Promise<string>;
	getTagsForNewTorrent(
		searcheeInfo?: { category: string },
		destinationDir?: string,
	): string;
};

let client: TemplateMethods;

beforeAll(async () => {
	const { default: QBittorrent } =
		await import("../../src/clients/QBittorrent.js");
	client = new QBittorrent(
		"http://test:test@localhost:8080",
		"localhost",
		1,
		false,
	) as unknown as TemplateMethods;
});

beforeEach(() => {
	mockConfig.categoryTemplate = undefined;
	mockConfig.tagsTemplate = undefined;
	mockConfig.duplicateCategories = false;
});

describe("qBittorrent category and tag templates", () => {
	it("renders the searchee category", async () => {
		mockConfig.categoryTemplate = "{searcheeCategory}.cross-seed";
		mockConfig.tagsTemplate = ["cross-seed", "{searcheeCategory}"];

		await expect(
			client.getCategoryForNewTorrent("Movies", "/downloads", false, {
				category: "Movies",
			}),
		).resolves.toBe("Movies.cross-seed");
		expect(client.getTagsForNewTorrent({ category: "Movies" })).toBe(
			"cross-seed,Movies",
		);
	});

	it("preserves duplicateCategories behavior when templates are unset", async () => {
		mockConfig.duplicateCategories = true;

		await expect(
			client.getCategoryForNewTorrent("Movies", "/downloads", false, {
				category: "Movies",
			}),
		).resolves.toBe("Movies.cross-seed");
		expect(
			client.getTagsForNewTorrent({ category: "Movies" }, "/links"),
		).toBe("cross-seed,Movies.cross-seed");
	});

	it("falls back when a template variable is unavailable", async () => {
		mockConfig.categoryTemplate = "{searcheeCategory}.cross-seed";
		mockConfig.tagsTemplate = ["{searcheeCategory}"];

		await expect(
			client.getCategoryForNewTorrent(
				"cross-seed-link",
				"/downloads",
				false,
			),
		).resolves.toBe("cross-seed-link");
		expect(client.getTagsForNewTorrent()).toBe("cross-seed");
	});
});
