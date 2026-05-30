import { describe, expect, it } from "vitest";

import { mergeHeaders, substituteTemplateVars } from "../src/pushNotifier.js";

describe("substituteTemplateVars", () => {
	const vars = { name: "Movie.2024.1080p", trackers: "A, B" };

	it("substitutes known placeholders in string values", () => {
		expect(substituteTemplateVars({ title: "Found {name}" }, vars)).toEqual(
			{ title: "Found Movie.2024.1080p" },
		);
	});

	it("replaces every occurrence of a placeholder", () => {
		expect(substituteTemplateVars({ t: "{name} / {name}" }, vars)).toEqual({
			t: "Movie.2024.1080p / Movie.2024.1080p",
		});
	});

	it("leaves unknown placeholders untouched", () => {
		expect(substituteTemplateVars({ t: "{unknown}" }, vars)).toEqual({
			t: "{unknown}",
		});
	});

	it("recurses into nested objects and arrays", () => {
		expect(
			substituteTemplateVars(
				{ outer: { inner: "{name}" }, list: ["{trackers}"] },
				vars,
			),
		).toEqual({
			outer: { inner: "Movie.2024.1080p" },
			list: ["A, B"],
		});
	});

	it("leaves non-string primitives unchanged", () => {
		expect(
			substituteTemplateVars({ n: 3, b: true, z: null }, vars),
		).toEqual({ n: 3, b: true, z: null });
	});
});

describe("mergeHeaders", () => {
	const defaults = {
		"Content-Type": "application/json",
		"User-Agent": "cross-seed",
	};

	it("returns the defaults when there are no overrides", () => {
		expect(mergeHeaders(defaults)).toEqual(defaults);
	});

	it("adds new headers alongside the defaults", () => {
		expect(
			mergeHeaders(defaults, { Authorization: "Bearer token" }),
		).toEqual({ ...defaults, Authorization: "Bearer token" });
	});

	it("overrides a default case-insensitively without duplicating it", () => {
		const merged = mergeHeaders(defaults, {
			"content-type": "text/plain",
		});
		expect(merged).toEqual({
			"content-type": "text/plain",
			"User-Agent": "cross-seed",
		});
		expect(merged["Content-Type"]).toBeUndefined();
	});
});
