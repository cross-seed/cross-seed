import { describe, expect, it } from "vitest";
import { fileFactory } from "./factories/file.js";
import { searcheeFactory } from "./factories/searchee.js";

import { humanReadableSize } from "@cross-seed/shared/utils";
import { MediaType, SEASON_REGEX } from "../src/constants.js";
import { getMediaType } from "../src/searchee.js";
import {
	cleanBookAndAudioTitle,
	extractInt,
	sanitizeUrl,
} from "../src/utils.js";

describe("humanReadableSize", () => {
	it("returns a human-readable size", () => {
		expect(humanReadableSize(123)).toBe("123 B");
		expect(humanReadableSize(1234)).toBe("1.23 kB");
		expect(humanReadableSize(1000 * 1234)).toBe("1.23 MB");
		expect(humanReadableSize(1024 * 1234, { binary: true })).toBe(
			"1.21 MiB",
		);
	});

	it("truncates number when byte size is exact", () => {
		expect(humanReadableSize(1000)).toBe("1 kB");
	});
});

describe("getMediaType", () => {
	it("returns MediaType.EPISODE if the title matches EP_REGEX", () => {
		const searchee = searcheeFactory({ title: "My.Show.S01E01" });

		expect(getMediaType(searchee)).toBe(MediaType.EPISODE);
	});

	it("returns MediaType.SEASON if the title matches SEASON_REGEX", () => {
		const s1 = searcheeFactory({ title: "My.Show.S01" });
		expect(getMediaType(s1)).toBe(MediaType.SEASON);
		expect(extractInt(s1.title.match(SEASON_REGEX)!.groups!.season)).toBe(
			1,
		);
		const s2 = searcheeFactory({ title: "My.Show.Season 2" });
		expect(getMediaType(s2)).toBe(MediaType.SEASON);
		expect(extractInt(s2.title.match(SEASON_REGEX)!.groups!.season)).toBe(
			2,
		);
	});

	describe("when testing for video files by extension", () => {
		it("returns MediaType.MOVIE if the title matches MOVIE_REGEX", () => {
			const file = fileFactory({ name: "media.mp4" });
			const searchee = searcheeFactory({
				title: "My.Movie.2021",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.MOVIE);
		});

		it("returns MediaType.ANIME if the title matches ANIME_REGEX", () => {
			const file = fileFactory({ name: "media.mp4" });
			const searchee = searcheeFactory({
				title: "[GRP] My.Anime - 001",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.ANIME);
		});

		it("returns MediaType.VIDEO if the title does not match MOVIE_REGEX or ANIME_REGEX", () => {
			const file = fileFactory({ name: "media.mp4" });
			const searchee = searcheeFactory({
				title: "My.Video",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.VIDEO);
		});
	});

	describe("when testing RAR archives", () => {
		it("returns MediaType.MOVIE if the title matches MOVIE_REGEX", () => {
			const file = fileFactory({ name: "media.rar" });
			const searchee = searcheeFactory({
				title: "My.Movie.2021",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.MOVIE);
		});

		it("returns MediaType.AUDIO if one of the other files has an audio extension", () => {
			const archive = fileFactory({ name: "media.rar" });
			const audio = fileFactory({ name: "media.mp3" });
			const searchee = searcheeFactory({
				title: "My.Video",
				files: [archive, audio],
			});

			expect(getMediaType(searchee)).toBe(MediaType.AUDIO);
		});

		it("returns MediaType.BOOK if one of the other files has a book extension", () => {
			const archive = fileFactory({ name: "media.rar" });
			const book = fileFactory({ name: "media.epub" });
			const searchee = searcheeFactory({
				title: "My.Video",
				files: [archive, book],
			});

			expect(getMediaType(searchee)).toBe(MediaType.BOOK);
		});

		it("returns MediaType.OTHER if the title does not match MOVIE_REGEX", () => {
			const file = fileFactory({ name: "media.rar" });
			const searchee = searcheeFactory({
				title: "My.Other",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.OTHER);
		});
	});

	describe("when testing fallback behaviour", () => {
		it("returns MediaType.AUDIO if the file has an audio extension", () => {
			const file = fileFactory({ name: "media.mp3" });
			const searchee = searcheeFactory({
				title: "unknown",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.AUDIO);
		});

		it("returns MediaType.BOOK if the file has a book extension", () => {
			const file = fileFactory({ name: "media.epub" });
			const searchee = searcheeFactory({
				title: "unknown",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.BOOK);
		});

		it("returns MediaType.OTHER if the media type cannot be determined", () => {
			const file = fileFactory({ name: "media.xyz" });
			const searchee = searcheeFactory({
				title: "unknown",
				files: [file],
			});

			expect(getMediaType(searchee)).toBe(MediaType.OTHER);
		});
	});
});

describe("sanitizeUrl", () => {
	it("returns a string", () => {
		expect(sanitizeUrl("https://example.com/path")).toBe(
			"https://example.com/path",
		);
	});

	it("returns a string from URL object", () => {
		expect(sanitizeUrl(new URL("https://example.com/path"))).toBe(
			"https://example.com/path",
		);
	});

	it("appends a trailing slash to the host if the path is absent", () => {
		expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
	});

	it("strips the query string", () => {
		expect(sanitizeUrl("https://example.com/path?query=string")).toBe(
			"https://example.com/path",
		);
	});
});

describe("cleanBookAndAudioTitle", () => {
	it("preserves interior spaces in plain titles (#1204)", () => {
		expect(cleanBookAndAudioTitle("Jane Doe")).toBe("Jane Doe");
		expect(cleanBookAndAudioTitle("John Q Public")).toBe("John Q Public");
	});

	it("cleanses separators before matching", () => {
		expect(
			cleanBookAndAudioTitle("Widget Farming_ A Practical Guide"),
		).toBe("Widget Farming A Practical Guide");
	});

	it("strips every format token, not just the first match", () => {
		expect(cleanBookAndAudioTitle("Some Great Title mobi")).toBe(
			"Some Great Title",
		);
		expect(
			cleanBookAndAudioTitle("01 - A Widget Story - Jane Doe.epub"),
		).toBe("A Widget Story Jane Doe");
	});

	it("drops parenthesized source tags, catalog numbers and credits", () => {
		expect(
			cleanBookAndAudioTitle("(TTC) Jane Doe, A Widget Treatise.pdf"),
		).toBe("Jane Doe, A Widget Treatise");
		expect(
			cleanBookAndAudioTitle(
				"A Band - An Album (2004) [CD FLAC] {ABC 255}",
			),
		).toBe("A Band An Album");
		expect(
			cleanBookAndAudioTitle(
				"01 Around the World in 80 Days (Read by Patrick Tull).m4b",
			),
		).toBe("Around the World in 80 Days");
	});

	it("removes hyphens so the query is just author and title", () => {
		expect(cleanBookAndAudioTitle("Catch-22 - Joseph Heller.mobi")).toBe(
			"Catch 22 Joseph Heller",
		);
		expect(
			cleanBookAndAudioTitle("Gardening All-in-One For Beginners"),
		).toBe("Gardening All in One For Beginners");
		expect(cleanBookAndAudioTitle("A Band - 2000 - An Album - FLAC")).toBe(
			"A Band An Album",
		);
	});

	it("keeps numbers that belong to the title", () => {
		expect(
			cleanBookAndAudioTitle("Fahrenheit 451 - Ray Bradbury.epub"),
		).toBe("Fahrenheit 451 Ray Bradbury");
		expect(cleanBookAndAudioTitle("0310283205 A Widget Treatise.pdf")).toBe(
			"A Widget Treatise",
		);
	});

	it("still strips narrator credits", () => {
		expect(
			cleanBookAndAudioTitle("A Tale of Two Widgets Read By John Smith"),
		).toBe("A Tale of Two Widgets");
	});

	it("falls back to the cleansed title rather than emitting an empty query", () => {
		expect(cleanBookAndAudioTitle("1984.epub")).toBe("1984 epub");
	});
});
