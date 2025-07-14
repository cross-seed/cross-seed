import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

// Mock the runtime config
const mockConfig = {
	categoryTemplate: undefined,
	tagsTemplate: undefined,
};

vi.mock("../../src/runtimeConfig.js", () => ({
	getRuntimeConfig: () => mockConfig,
}));

vi.mock("../../src/logger.js", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
	Label: {
		QBITTORRENT: "qbittorrent",
	},
}));

// Mock only what's needed to avoid client initialization issues
vi.mock("../../src/utils.js", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...(actual as Record<string, unknown>),
		extractCredentialsFromUrl: vi.fn(() => ({
			unwrapOrThrow: vi.fn(() => ({
				url: "http://localhost:8080/api/v2",
				username: "test",
				password: "test",
			})),
		})),
	};
});

let QBittorrentTest: { default: new (...args: unknown[]) => unknown };
let qbClient: Record<string, unknown>;
let getCategoryForNewTorrent: (searcheeInfo: {
	category?: string | null;
}) => string | undefined;
let getTagsForNewTorrent: (searcheeInfo: {
	category?: string | null;
}) => string[];

beforeAll(async () => {
	// Import and create minimal QBittorrent instance just to access the methods
	QBittorrentTest = await import("../../src/clients/QBittorrent.js");
	qbClient = new QBittorrentTest.default(
		"http://test:test@localhost:8080",
		"localhost",
		1,
		false,
	);

	// Extract the actual methods from the class instance
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const clientMethods = qbClient as any;
	getCategoryForNewTorrent =
		clientMethods.getCategoryForNewTorrent?.bind(clientMethods);
	getTagsForNewTorrent =
		clientMethods.getTagsForNewTorrent?.bind(clientMethods);

	if (!getCategoryForNewTorrent || !getTagsForNewTorrent) {
		throw new Error("Methods not found on QBittorrent instance");
	}
});

describe("QBittorrent template methods", () => {
	beforeEach(() => {
		// Reset config before each test
		mockConfig.categoryTemplate = undefined;
		mockConfig.tagsTemplate = undefined;
		vi.clearAllMocks();
	});

	describe("getCategoryForNewTorrent", () => {
		it("should return undefined when categoryTemplate is undefined", () => {
			const searcheeInfo = { category: "Movies" };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBeUndefined();
		});

		it("should return undefined when searcheeCategory is null", () => {
			mockConfig.categoryTemplate = "cross-seed-{searcheeCategory}";
			const searcheeInfo = { category: null };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBeUndefined();
		});

		it("should return undefined when searcheeInfo is undefined", () => {
			mockConfig.categoryTemplate = "cross-seed-{searcheeCategory}";
			const result = getCategoryForNewTorrent(undefined);

			expect(result).toBeUndefined();
		});

		it("should render template with searcheeCategory", () => {
			mockConfig.categoryTemplate = "cross-seed-{searcheeCategory}";
			const searcheeInfo = { category: "Movies" };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBe("cross-seed-Movies");
		});

		it("should render template with multiple placeholders", () => {
			mockConfig.categoryTemplate =
				"{searcheeCategory}-cross-seed-{searcheeCategory}";
			const searcheeInfo = { category: "TV" };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBe("TV-cross-seed-TV");
		});

		it("should handle template without placeholders", () => {
			mockConfig.categoryTemplate = "static-category";
			const searcheeInfo = { category: "Movies" };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBe("static-category");
		});

		it("should handle empty string category", () => {
			mockConfig.categoryTemplate = "cross-seed-{searcheeCategory}";
			const searcheeInfo = { category: "" };
			const result = getCategoryForNewTorrent(searcheeInfo);

			expect(result).toBeUndefined();
		});
	});

	describe("getTagsForNewTorrent", () => {
		it("should return TORRENT_TAG when tagsTemplate is undefined", () => {
			const searcheeInfo = { category: "Movies" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["cross-seed"]);
		});

		it("should return TORRENT_TAG when tagsTemplate is empty array", () => {
			mockConfig.tagsTemplate = [];
			const searcheeInfo = { category: "Movies" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["cross-seed"]);
		});

		it("should return TORRENT_TAG when searcheeInfo is undefined", () => {
			mockConfig.tagsTemplate = ["cross-seed", "{searcheeCategory}"];
			const result = getTagsForNewTorrent(undefined);

			expect(result).toEqual(["cross-seed"]);
		});

		it("should render single tag template", () => {
			mockConfig.tagsTemplate = ["cross-seed-{searcheeCategory}"];
			const searcheeInfo = { category: "Movies" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["cross-seed-Movies"]);
		});

		it("should render multiple tag templates", () => {
			mockConfig.tagsTemplate = [
				"cross-seed",
				"{searcheeCategory}",
				"custom-{searcheeCategory}",
			];
			const searcheeInfo = { category: "TV" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["cross-seed", "TV", "custom-TV"]);
		});

		it("should handle template without placeholders", () => {
			mockConfig.tagsTemplate = ["static-tag1", "static-tag2"];
			const searcheeInfo = { category: "Movies" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["static-tag1", "static-tag2"]);
		});

		it("should handle empty string category", () => {
			mockConfig.tagsTemplate = ["cross-seed", "{searcheeCategory}"];
			const searcheeInfo = { category: "" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["cross-seed"]);
		});

		it("should handle multiple placeholders in single tag", () => {
			mockConfig.tagsTemplate = ["{searcheeCategory}-{searcheeCategory}"];
			const searcheeInfo = { category: "Music" };
			const result = getTagsForNewTorrent(searcheeInfo);

			expect(result).toEqual(["Music-Music"]);
		});
	});
});
