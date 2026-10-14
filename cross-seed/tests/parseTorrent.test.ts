import bencode from "bencode";
import { describe, expect, it } from "vitest";

import { Metafile, type Torrent } from "../src/parseTorrent.js";

// A bencoded byte string: "<length>:<bytes>".
function bstr(buf: Buffer): Buffer {
	return Buffer.concat([Buffer.from(`${buf.length}:`), buf]);
}

// Build a hybrid (v1 + v2) torrent whose top-level "piece layers" dict is keyed
// by a 32-byte binary hash, the shape BEP 52 uses. bencode.decode turns that key
// into a string, so a re-encode no longer reproduces the original bytes (#1192).
// The info dict, by contrast, has only string keys and round-trips faithfully.
// Keys are assembled in bencode's required sorted order ("info" < "piece layers").
function hybridTorrentBytes(pieceLayerKey: Buffer): Buffer {
	const info = bencode.encode({
		"file tree": {
			"hybrid.bin": {
				"": { length: 1024, "pieces root": Buffer.alloc(32, 0x11) },
			},
		},
		length: 1024,
		"meta version": 2,
		name: Buffer.from("hybrid.bin"),
		"piece length": 16384,
		pieces: Buffer.alloc(20, 0x01),
	});
	const pieceLayers = Buffer.concat([
		Buffer.from("d"),
		bstr(pieceLayerKey),
		bstr(Buffer.alloc(32, 0xab)),
		Buffer.from("e"),
	]);
	return Buffer.concat([
		Buffer.from("d"),
		bstr(Buffer.from("info")),
		info,
		bstr(Buffer.from("piece layers")),
		pieceLayers,
		Buffer.from("e"),
	]);
}

describe("Metafile.encode", () => {
	// 32 lone UTF-8 continuation bytes (0x80..0x9f): not valid UTF-8, so the key
	// cannot survive a decode-to-string then re-encode.
	const binaryKey = Buffer.from(
		Array.from({ length: 32 }, (_, i) => 0x80 + i),
	);

	it("re-encodes a hybrid torrent to its exact original bytes (#1192)", () => {
		const original = hybridTorrentBytes(binaryKey);

		// Precondition: this torrent is one bencode cannot round-trip.
		expect(bencode.encode(bencode.decode(original)).equals(original)).toBe(
			false,
		);

		const meta = Metafile.decode(original);
		// The metafile is usable, not merely a byte container.
		expect(meta.name).toBe("hybrid.bin");
		expect(meta.length).toBe(1024);
		// The fix: encode() reproduces the original bytes exactly.
		expect(meta.encode().equals(original)).toBe(true);
	});

	it("encodes from the raw object when not decoded from a buffer", () => {
		// A metafile built from an object (the rTorrent resume path) has no source
		// buffer and falls back to bencode.encode; all-string keys round-trip.
		const raw = {
			info: {
				length: 512,
				name: Buffer.from("plain.bin"),
				"piece length": 16384,
				pieces: Buffer.alloc(20, 0x02),
			},
		} as unknown as Torrent;
		const meta = new Metafile(raw);
		expect(meta.encode().equals(bencode.encode(raw))).toBe(true);
	});
});
