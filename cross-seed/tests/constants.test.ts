import { describe, expect, it } from "vitest";

import {
	BAD_EP_REGEX,
	BAD_GROUP_PARSE_REGEX,
	EP_REGEX,
} from "../src/constants.js";

describe("EP_REGEX", () => {
	it("matches episode titles", () => {
		const validTitles = [
			"My.Show.S01E01",
			// TODO: Add more valid titles
		];

		validTitles.forEach((title) => {
			expect(title).toMatch(EP_REGEX);
		});
	});

	it("does not match non-episode titles", () => {
		const invalidTitles = [
			"My.Show.S01",
			// TODO: Add more invalid titles
		];

		invalidTitles.forEach((title) => {
			expect(title).not.toMatch(EP_REGEX);
		});
	});
});

describe("BAD_EP_REGEX", () => {
	it.each([
		"S01E02.Title.1080p",
		"S01.E02.Title",
		"S01 E02 Title",
		"s01e02.title",
		"S01E02E03.Title",
		"E05.Title.720p",
		"ShowS01E02.1080p",
		"[Group]S01E02.mkv",
		"2024.01.05.Show",
	])("matches %j, which does not start with a title", (title) => {
		expect(title).toMatch(BAD_EP_REGEX);
	});

	it.each([
		"Se7en.1995.1080p.MA.WEBRip.DDP5.1.x264-ZoroSenpai.mkv",
		"Re4.2020.1080p",
		"My.Show.S01E01",
		"Seven.1995.1080p",
	])("does not match %j", (title) => {
		expect(title).not.toMatch(BAD_EP_REGEX);
	});
});

describe("BAD_GROUP_PARSE_REGEX", () => {
	it.each([
		"1080p",
		"x264",
		"h.264",
		"DD5.1",
		"DL.DDP5.1",
		"eac3 5.1",
		"ma hd",
		"full blu ray",
		"Season 1 720p",
		"x2 6",
	])("matches %j, which is not a release group", (text) => {
		expect(text).toMatch(BAD_GROUP_PARSE_REGEX);
	});

	it.each([
		"NTb",
		"FLUX",
		"SPARKS",
		"AMZN",
		"WEB-DL",
		"dts",
		"12",
		"season 1",
		"1080p.WEB.DL",
	])("does not match %j", (text) => {
		expect(text).not.toMatch(BAD_GROUP_PARSE_REGEX);
	});

	it.each([
		["a long run of digits", "1".repeat(30) + "x"],
		["dots before digits", ".4".repeat(30) + "x"],
		["dots before x and a digit", ".x4".repeat(30) + "!z"],
	])("returns quickly for %s that end in a mismatch", (_, text) => {
		const start = performance.now();
		expect(text).not.toMatch(BAD_GROUP_PARSE_REGEX);
		expect(performance.now() - start).toBeLessThan(1000);
	});
});
