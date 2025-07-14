import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils.js", () => ({ errorCode: vi.fn() }));

import { parseRuntimeConfigOverrides } from "../src/configSchema.js";
import { transformFileConfig } from "../src/configuration.js";

describe("category and tag templates", () => {
	it("transforms config-file values into runtime config", () => {
		expect(
			transformFileConfig({
				categoryTemplate: "{searcheeCategory}.cross-seed",
				tagsTemplate: "cross-seed, {searcheeCategory}",
			}),
		).toEqual({
			categoryTemplate: "{searcheeCategory}.cross-seed",
			tagsTemplate: ["cross-seed", "{searcheeCategory}"],
		});
	});

	it("accepts template runtime overrides", () => {
		expect(
			parseRuntimeConfigOverrides({
				categoryTemplate: "cross-seed",
				tagsTemplate: ["cross-seed"],
			}),
		).toEqual({
			categoryTemplate: "cross-seed",
			tagsTemplate: ["cross-seed"],
		});
	});
});
