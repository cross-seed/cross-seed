import bencode from "bencode";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Metafile, Torrent } from "../src/parseTorrent.js";
import { buildHybridTorrent } from "./support/hybridTorrent.js";

const sha1 = (data: Buffer) =>
	createHash("sha1").update(new Uint8Array(data)).digest("hex");

describe("Metafile with a hybrid torrent", () => {
	const hybrid = buildHybridTorrent();

	it("uses a piece layers key that the bencode package corrupts", () => {
		// guards this suite: if this ever passes, the tests below prove nothing
		const key = hybrid.piecesRoot;
		expect(Buffer.from(key.toString("utf8")).equals(key)).toBe(false);
		const viaPackage = Buffer.from(
			bencode.encode(bencode.decode(hybrid.torrent)),
		);
		expect(viaPackage.equals(hybrid.torrent)).toBe(false);
	});

	it("encodes back to the exact bytes it was decoded from", () => {
		const meta = Metafile.decode(hybrid.torrent);
		expect(meta.encode().equals(hybrid.torrent)).toBe(true);
	});

	it("computes the v1 infohash from the exact info dictionary bytes", () => {
		const meta = Metafile.decode(hybrid.torrent);
		expect(meta.infoHash).toBe(sha1(hybrid.info));
	});

	it("computes the infohash from the exact bytes when info has a key that is not UTF-8", () => {
		const withKey = buildHybridTorrent({ binaryInfoKey: true });
		// guards this test: the bencode package changes the key, and so the hash
		const decoded = bencode.decode(withKey.torrent) as { info: unknown };
		const viaPackage = Buffer.from(bencode.encode(decoded.info));
		expect(viaPackage.equals(withKey.info)).toBe(false);

		const meta = Metafile.decode(withKey.torrent);
		expect(meta.infoHash).toBe(sha1(withKey.info));
	});

	it("reads the torrent's metadata", () => {
		const meta = Metafile.decode(hybrid.torrent);
		expect(meta.name).toBe(hybrid.name);
		expect(meta.length).toBe(hybrid.length);
		expect(meta.pieceLength).toBe(16384);
		expect(meta.isSingleFileTorrent).toBe(true);
		expect(meta.trackers).toEqual(["tracker.example"]);
		expect(meta.files).toEqual([
			{ name: hybrid.name, path: hybrid.name, length: hybrid.length },
		]);
	});

	it("keeps piece layers when fields are added, like rTorrent injection does", () => {
		const meta = Metafile.decode(hybrid.torrent);
		const extended = new Metafile({
			...meta.raw,
			libtorrent_resume: { bitfield: 2, files: [{ completed: 2 }] },
		} as Torrent);

		const reDecoded = Metafile.decode(extended.encode());
		expect(reDecoded.infoHash).toBe(meta.infoHash);
		const layers = (reDecoded.raw as unknown as Record<string, unknown>)[
			"piece layers"
		] as Record<string, Buffer>;
		expect(Object.keys(layers)).toEqual([
			hybrid.piecesRoot.toString("latin1"),
		]);
		expect(layers[hybrid.piecesRoot.toString("latin1")]).toEqual(
			hybrid.pieceLayer,
		);
	});
});

describe("Metafile with a v1 torrent", () => {
	const raw = {
		announce: Buffer.from("https://tracker.example/announce"),
		info: {
			files: [
				{
					length: 1234,
					path: [Buffer.from("dir"), Buffer.from("日本語.mkv")],
				},
				{ length: 5, path: [Buffer.from("b.nfo")] },
			],
			name: Buffer.from("Some.Release"),
			"piece length": 262144,
			pieces: Buffer.alloc(40, 7),
			private: 1,
		},
	};
	const encoded = Buffer.from(bencode.encode(raw));

	it("keeps the infohash the bencode package produced", () => {
		expect(Metafile.decode(encoded).infoHash).toBe(
			sha1(Buffer.from(bencode.encode(raw.info))),
		);
	});

	it("round trips to the same bytes", () => {
		expect(Metafile.decode(encoded).encode().equals(encoded)).toBe(true);
	});

	it.each([
		["a byte string", Buffer.from("abcd")],
		["zero", 0],
		["a negative number", -1],
	])("rejects a piece length that is %s", (_name, pieceLength) => {
		const bad = Buffer.from(
			bencode.encode({
				...raw,
				info: { ...raw.info, "piece length": pieceLength },
			}),
		);
		expect(() => Metafile.decode(bad)).toThrow(
			"Torrent is missing required field: info['piece length']",
		);
	});

	it("rejects a dictionary that is not a torrent", () => {
		expect(() => Metafile.decode(Buffer.from("d3:fooi1ee"))).toThrow(
			"Torrent is missing required field: info",
		);
	});

	it("does not produce a Metafile from text that is not bencode", () => {
		// no message is asserted, it is the codec's and varies between them
		expect(() => Metafile.decode(Buffer.from("not bencode"))).toThrow();
	});
});
