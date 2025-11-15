import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the logger before importing the config schema
vi.mock("../src/logger.js", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
	Label: {
		QBITTORRENT: "qbittorrent",
		RTORRENT: "rtorrent",
		TRANSMISSION: "transmission",
		DELUGE: "deluge",
	},
}));

import { VALIDATION_SCHEMA } from "../src/configSchema";
import { logger } from "../src/logger";

// Base config with all required fields
const baseConfig = {
	delay: 30,
	torznab: ["http://example.com"],
	torrentClients: ["qbittorrent:https://localhost:8080"],
	action: "inject",
	matchMode: "strict",
	skipRecheck: true,
	autoResumeMaxDownload: 0,
	linkType: "hardlink",
	maxDataDepth: 1,
	fuzzySizeThreshold: 0.02,
	includeSingleEpisodes: false,
	includeNonVideos: false,
	duplicateCategories: false,
	verbose: false,
	linkDirs: [],
};

describe("config schema - categoryTemplate and tagsTemplate", () => {
	beforeEach(() => {
		// Clear mock calls before each test
		vi.clearAllMocks();
	});
	describe("when categoryTemplate and tagsTemplate are defined", () => {
		it("should not override categoryTemplate with linkCategory", () => {
			const config = {
				...baseConfig,
				// New options explicitly set
				categoryTemplate: "custom-category",
				tagsTemplate: ["custom-tag"],
				// Legacy options that should not override
				linkCategory: "legacy-category",
				linkDirs: ["/path/to/links", "/path/to/links2"], // Enable linking
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("custom-category");
				expect(result.data.tagsTemplate).toEqual(["custom-tag"]);
			}
		});

		it("should not override tagsTemplate with duplicateCategories", () => {
			const config = {
				...baseConfig,
				// New options explicitly set
				categoryTemplate: "custom-category",
				tagsTemplate: ["custom-tag1", "custom-tag2"],
				// Legacy options that should not override
				linkCategory: "legacy-category",
				duplicateCategories: true,
				linkDirs: ["/path/to/links", "/path/to/links2"], // Enable linking
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("custom-category");
				expect(result.data.tagsTemplate).toEqual([
					"custom-tag1",
					"custom-tag2",
				]);
			}
		});
	});

	describe("when categoryTemplate and tagsTemplate are undefined", () => {
		it("should set categoryTemplate from linkCategory when linking is enabled", () => {
			const config = {
				...baseConfig,
				// Legacy options
				linkCategory: "legacy-category",
				linkDirs: ["/path/to/links", "/path/to/links2"], // Enable linking
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("legacy-category");
				expect(result.data.tagsTemplate).toEqual(["cross-seed"]);
			}
		});

		it("should set tagsTemplate based on duplicateCategories when linking is enabled", () => {
			const config = {
				...baseConfig,
				// Legacy options
				linkCategory: "legacy-category",
				duplicateCategories: true,
				linkDirs: ["/path/to/links", "/path/to/links2"], // Enable linking
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("legacy-category");
				expect(result.data.tagsTemplate).toEqual([
					"cross-seed",
					"{searcheeCategory}..cross-seed",
				]);
			}
		});

		it("should set default values when linking is disabled", () => {
			const config = {
				...baseConfig,
				// Legacy options
				linkCategory: "legacy-category",
				linkDirs: [], // Disable linking
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("{searcheeCategory}");
				expect(result.data.tagsTemplate).toEqual(["cross-seed"]);
			}
		});
	});

	describe("tagsTemplate string transformation", () => {
		it("should transform comma-separated string to array", () => {
			const config = {
				...baseConfig,
				tagsTemplate: "tag1, tag2, tag3",
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.tagsTemplate).toEqual([
					"tag1",
					"tag2",
					"tag3",
				]);
			}
		});

		it("should accept array directly", () => {
			const config = {
				...baseConfig,
				tagsTemplate: ["tag1", "tag2", "tag3"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.tagsTemplate).toEqual([
					"tag1",
					"tag2",
					"tag3",
				]);
			}
		});
	});

	describe("qBittorrent client validation for categoryTemplate and tagsTemplate", () => {
		it("should allow categoryTemplate with qBittorrent client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["qbittorrent:http://localhost:8080"],
				categoryTemplate: "custom-category",
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("custom-category");
			}
		});

		it("should allow tagsTemplate with qBittorrent client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["qbittorrent:http://localhost:8080"],
				tagsTemplate: ["custom-tag"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
			if (result.success) {
				expect(result.data.tagsTemplate).toEqual(["custom-tag"]);
			}
		});

		it("should allow both categoryTemplate and tagsTemplate with qBittorrent client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["qbittorrent:http://localhost:8080"],
				categoryTemplate: "custom-category",
				tagsTemplate: ["custom-tag"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("custom-category");
				expect(result.data.tagsTemplate).toEqual(["custom-tag"]);
			}
		});

		it("should warn when categoryTemplate used with non-qBittorrent client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["rtorrent:http://localhost:1234/RPC2"],
				categoryTemplate: "custom-category",
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).toHaveBeenCalledWith(
				"categoryTemplate and tagsTemplate are only supported for qBittorrent client, ignoring these options for other clients.",
			);
		});

		it("should warn when tagsTemplate used with non-qBittorrent client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["transmission:http://localhost:9091"],
				tagsTemplate: ["custom-tag"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).toHaveBeenCalledWith(
				"categoryTemplate and tagsTemplate are only supported for qBittorrent client, ignoring these options for other clients.",
			);
		});

		it("should warn when both options used with deluge client", () => {
			const config = {
				...baseConfig,
				torrentClients: ["deluge:http://:password@localhost:8112/json"],
				categoryTemplate: "custom-category",
				tagsTemplate: ["custom-tag"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			// Should still succeed but with warning
			expect(result.success).toBe(true);
			expect(logger.warn).toHaveBeenCalledWith(
				"categoryTemplate and tagsTemplate are only supported for qBittorrent client, ignoring these options for other clients.",
			);
		});

		it("should allow when qBittorrent is mixed with other clients", () => {
			const config = {
				...baseConfig,
				torrentClients: [
					"qbittorrent:http://localhost:8080",
					"rtorrent:http://localhost:1234/RPC2",
				],
				categoryTemplate: "custom-category",
				tagsTemplate: ["custom-tag"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
			if (result.success) {
				expect(result.data.categoryTemplate).toBe("custom-category");
				expect(result.data.tagsTemplate).toEqual(["custom-tag"]);
			}
		});

		it("should work fine when neither categoryTemplate nor tagsTemplate are set", () => {
			const config = {
				...baseConfig,
				torrentClients: ["rtorrent:http://localhost:1234/RPC2"],
			};

			const result = VALIDATION_SCHEMA.safeParse(config);

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
		});
	});
});
