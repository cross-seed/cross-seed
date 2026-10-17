import bencode from "bencode";
import { describe, expect, it } from "vitest";
import { Metafile } from "../src/parseTorrent.js";

const base = {
	"piece length": 16384,
	pieces: Buffer.alloc(20, 1),
};

function singleFile(name: string, key: "name" | "name.utf-8" = "name") {
	return Buffer.from(
		bencode.encode({
			info: { ...base, length: 1, [key]: Buffer.from(name) },
		}),
	);
}

function multiFile(name: string, ...path: string[]) {
	return Buffer.from(
		bencode.encode({
			info: {
				...base,
				name: Buffer.from(name),
				files: [{ length: 1, path: path.map((s) => Buffer.from(s)) }],
			},
		}),
	);
}

describe("Metafile paths", () => {
	it("reads a name and file paths that stay inside their directory", () => {
		expect(Metafile.decode(singleFile("Some.Release.mkv")).files).toEqual([
			{ name: "Some.Release.mkv", path: "Some.Release.mkv", length: 1 },
		]);
		expect(
			Metafile.decode(multiFile("Some.Release", "sub", "a.mkv")).files,
		).toEqual([
			{ name: "a.mkv", path: "Some.Release/sub/a.mkv", length: 1 },
		]);
	});

	it.each(["..a", "a..", "a..b", "...", "X: The Series", "a b/c d", "é/ü"])(
		"accepts the name %j",
		(name) => {
			expect(Metafile.decode(singleFile(name)).name).toBe(name);
			expect(Metafile.decode(multiFile(name, "a.mkv")).name).toBe(name);
		},
	);

	it.each([
		"..",
		"../evil.mkv",
		"../../escaped/evil.mkv",
		"a/../../evil.mkv",
		"a/..",
		"a\\..\\..\\evil.mkv",
		"/etc/evil.mkv",
		"\\evil.mkv",
		"C:\\evil.mkv",
		"c:/evil.mkv",
	])("rejects the name %j", (name) => {
		const message = "Torrent has a path outside of its directory";
		expect(() => Metafile.decode(singleFile(name))).toThrow(message);
		expect(() => Metafile.decode(singleFile(name, "name.utf-8"))).toThrow(
			message,
		);
		expect(() => Metafile.decode(multiFile(name, "a.mkv"))).toThrow(
			message,
		);
	});

	it.each([
		[".."],
		["..", "evil.mkv"],
		["sub", "..", "..", "evil.mkv"],
		["sub/../../evil.mkv"],
		["sub\\..\\..\\evil.mkv"],
	])("rejects the file path %j", (...path) => {
		expect(() => Metafile.decode(multiFile("Release", ...path))).toThrow(
			"Torrent has a path outside of its directory",
		);
	});

	it("keeps a file path that starts at a root inside the torrent's directory", () => {
		const meta = Metafile.decode(multiFile("Release", "/etc/evil.mkv"));
		expect(meta.files[0].path).toBe("Release/etc/evil.mkv");
	});

	it("names the offending path in the error", () => {
		expect(() => Metafile.decode(singleFile("../evil.mkv"))).toThrow(
			'"../evil.mkv"',
		);
	});

	it("does not put a whole oversized path in the error", () => {
		const name = "../" + "a".repeat(10_000);
		let message = "";
		try {
			Metafile.decode(singleFile(name));
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain("outside of its directory");
		expect(message.length).toBeLessThan(300);
	});
});
