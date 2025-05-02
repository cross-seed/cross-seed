"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var constants_1 = require("../src/constants");
(0, vitest_1.describe)("EP_REGEX", function () {
	(0, vitest_1.it)("matches episode titles", function () {
		var validTitles = [
			"My.Show.S01E01",
			// TODO: Add more valid titles
		];
		validTitles.forEach(function (title) {
			(0, vitest_1.expect)(title).toMatch(constants_1.EP_REGEX);
		});
	});
	(0, vitest_1.it)("does not match non-episode titles", function () {
		var invalidTitles = [
			"My.Show.S01",
			// TODO: Add more invalid titles
		];
		invalidTitles.forEach(function (title) {
			(0, vitest_1.expect)(title).not.toMatch(constants_1.EP_REGEX);
		});
	});
});
