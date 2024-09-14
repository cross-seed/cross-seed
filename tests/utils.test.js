"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var file_1 = require("./factories/file");
var searchee_1 = require("./factories/searchee");
var constants_1 = require("../src/constants");
var searchee_2 = require("../src/searchee");
var utils_1 = require("../src/utils");
(0, vitest_1.describe)("humanReadableSize", function () {
    (0, vitest_1.it)("returns a human-readable size", function () {
        (0, vitest_1.expect)((0, utils_1.humanReadableSize)(123)).toBe("123 B");
        (0, vitest_1.expect)((0, utils_1.humanReadableSize)(1234)).toBe("1.23 kB");
        (0, vitest_1.expect)((0, utils_1.humanReadableSize)(1000 * 1234)).toBe("1.23 MB");
        (0, vitest_1.expect)((0, utils_1.humanReadableSize)(1024 * 1234, { binary: true })).toBe("1.21 MiB");
    });
    (0, vitest_1.it)("truncates number when byte size is exact", function () {
        (0, vitest_1.expect)((0, utils_1.humanReadableSize)(1000)).toBe("1 kB");
    });
});
(0, vitest_1.describe)("getMediaType", function () {
    (0, vitest_1.it)("returns MediaType.EPISODE if the title matches EP_REGEX", function () {
        var searchee = (0, searchee_1.searcheeFactory)({ title: "My.Show.S01E01" });
        (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.EPISODE);
    });
    (0, vitest_1.it)("returns MediaType.SEASON if the title matches SEASON_REGEX", function () {
        var s1 = (0, searchee_1.searcheeFactory)({ title: "My.Show.S01" });
        (0, vitest_1.expect)((0, searchee_2.getMediaType)(s1)).toBe(constants_1.MediaType.SEASON);
        (0, vitest_1.expect)((0, utils_1.extractInt)(s1.title.match(constants_1.SEASON_REGEX).groups.season)).toBe(1);
        var s2 = (0, searchee_1.searcheeFactory)({ title: "My.Show.Season 2" });
        (0, vitest_1.expect)((0, searchee_2.getMediaType)(s2)).toBe(constants_1.MediaType.SEASON);
        (0, vitest_1.expect)((0, utils_1.extractInt)(s2.title.match(constants_1.SEASON_REGEX).groups.season)).toBe(2);
    });
    (0, vitest_1.describe)("when testing for video files by extension", function () {
        (0, vitest_1.it)("returns MediaType.MOVIE if the title matches MOVIE_REGEX", function () {
            var file = (0, file_1.fileFactory)({ name: "media.mp4" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Movie.2021",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.MOVIE);
        });
        (0, vitest_1.it)("returns MediaType.ANIME if the title matches ANIME_REGEX", function () {
            var file = (0, file_1.fileFactory)({ name: "media.mp4" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "[GRP] My.Anime - 001",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.ANIME);
        });
        (0, vitest_1.it)("returns MediaType.VIDEO if the title does not match MOVIE_REGEX or ANIME_REGEX", function () {
            var file = (0, file_1.fileFactory)({ name: "media.mp4" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Video",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.VIDEO);
        });
    });
    (0, vitest_1.describe)("when testing RAR archives", function () {
        (0, vitest_1.it)("returns MediaType.MOVIE if the title matches MOVIE_REGEX", function () {
            var file = (0, file_1.fileFactory)({ name: "media.rar" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Movie.2021",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.MOVIE);
        });
        (0, vitest_1.it)("returns MediaType.AUDIO if one of the other files has an audio extension", function () {
            var archive = (0, file_1.fileFactory)({ name: "media.rar" });
            var audio = (0, file_1.fileFactory)({ name: "media.mp3" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Video",
                files: [archive, audio],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.AUDIO);
        });
        (0, vitest_1.it)("returns MediaType.BOOK if one of the other files has a book extension", function () {
            var archive = (0, file_1.fileFactory)({ name: "media.rar" });
            var book = (0, file_1.fileFactory)({ name: "media.epub" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Video",
                files: [archive, book],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.BOOK);
        });
        (0, vitest_1.it)("returns MediaType.OTHER if the title does not match MOVIE_REGEX", function () {
            var file = (0, file_1.fileFactory)({ name: "media.rar" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "My.Other",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.OTHER);
        });
    });
    (0, vitest_1.describe)("when testing fallback behaviour", function () {
        (0, vitest_1.it)("returns MediaType.AUDIO if the file has an audio extension", function () {
            var file = (0, file_1.fileFactory)({ name: "media.mp3" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "unknown",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.AUDIO);
        });
        (0, vitest_1.it)("returns MediaType.BOOK if the file has a book extension", function () {
            var file = (0, file_1.fileFactory)({ name: "media.epub" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "unknown",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.BOOK);
        });
        (0, vitest_1.it)("returns MediaType.OTHER if the media type cannot be determined", function () {
            var file = (0, file_1.fileFactory)({ name: "media.xyz" });
            var searchee = (0, searchee_1.searcheeFactory)({
                title: "unknown",
                files: [file],
            });
            (0, vitest_1.expect)((0, searchee_2.getMediaType)(searchee)).toBe(constants_1.MediaType.OTHER);
        });
    });
});
(0, vitest_1.describe)("sanitizeUrl", function () {
    (0, vitest_1.it)("returns a string", function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeUrl)("https://example.com/path")).toBe("https://example.com/path");
    });
    (0, vitest_1.it)("returns a string from URL object", function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeUrl)(new URL("https://example.com/path"))).toBe("https://example.com/path");
    });
    (0, vitest_1.it)("appends a trailing slash to the host if the path is absent", function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeUrl)("https://example.com")).toBe("https://example.com/");
    });
    (0, vitest_1.it)("strips the query string", function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeUrl)("https://example.com/path?query=string")).toBe("https://example.com/path");
    });
});
