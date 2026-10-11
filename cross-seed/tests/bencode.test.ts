import bencode from "bencode";
import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/bencode.js";

const buf = (value: string) => Buffer.from(value, "latin1");

describe("decode", () => {
	it("decodes integers", () => {
		expect(decode(buf("i42e"))).toBe(42);
		expect(decode(buf("i0e"))).toBe(0);
		expect(decode(buf("i-17e"))).toBe(-17);
		expect(decode(buf("i-0e"))).toBe(0);
		expect(decode(buf("i9007199254740991e"))).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("decodes byte strings to Buffers", () => {
		expect(decode(buf("4:spam"))).toEqual(Buffer.from("spam"));
		expect(decode(buf("0:"))).toEqual(Buffer.alloc(0));
		expect(decode(buf("3:\x00\xff:"))).toEqual(
			Buffer.from([0x00, 0xff, 0x3a]),
		);
		expect(Buffer.isBuffer(decode(buf("1:a")))).toBe(true);
	});

	it("decodes lists and dictionaries", () => {
		expect(decode(buf("le"))).toEqual([]);
		expect(decode(buf("de"))).toEqual({});
		expect(decode(buf("l4:spami3eli1eee"))).toEqual([
			Buffer.from("spam"),
			3,
			[1],
		]);
		expect(decode(buf("d3:cow3:moo4:spaml1:a1:bee"))).toEqual({
			cow: Buffer.from("moo"),
			spam: [Buffer.from("a"), Buffer.from("b")],
		});
	});

	it("keeps dictionary keys as one character per byte", () => {
		const decoded = decode(buf("d2:\x80\xffi1e0:i2ee")) as Record<
			string,
			number
		>;
		expect(Object.keys(decoded)).toEqual(["\x80\xff", ""]);
		expect(decoded["\x80\xff"]).toBe(1);
		expect(decoded[""]).toBe(2);
	});

	it("accepts any Uint8Array and returns Buffers", () => {
		const decoded = decode(
			new Uint8Array(Buffer.from("d1:a1:be")),
		) as Record<string, unknown>;
		expect(Buffer.isBuffer(decoded.a)).toBe(true);
		expect((decoded.a as Buffer).toString()).toBe("b");
	});

	it("respects the byteOffset of a view into a larger buffer", () => {
		const backing = Buffer.from("xxxd1:ai7eexxx");
		expect(decode(backing.subarray(3, 11))).toEqual({ a: 7 });
	});

	it("ignores bytes after the first value", () => {
		expect(decode(buf("i1e\n"))).toBe(1);
	});

	it("does not let a __proto__ key replace the prototype", () => {
		const decoded = decode(buf("d9:__proto__d1:xi1eee")) as object;
		expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
		expect(Object.keys(decoded)).toEqual(["__proto__"]);
		expect(({} as Record<string, unknown>).x).toBeUndefined();
		expect(encode(decoded)).toEqual(buf("d9:__proto__d1:xi1eee"));
	});

	it.each([
		["empty input", ""],
		["an unknown type", "x"],
		["a truncated integer", "i12"],
		["an integer without digits", "ie"],
		["a lone minus sign", "i-e"],
		["a float", "i1.5e"],
		["an integer above 2^53", "i9007199254740992e"],
		["a truncated string", "5:abc"],
		["a string length longer than the data", "99999999999999999999:a"],
		["a missing colon", "3abc"],
		["an unterminated list", "li1e"],
		["an unterminated dictionary", "d1:ai1e"],
		["a dictionary key without a value", "d1:ae"],
		["a dictionary key that is not a string", "di1ei2ee"],
	])("rejects %s", (_name, input) => {
		expect(() => decode(buf(input))).toThrow(/bencode|end of data/i);
	});

	it("rejects input that is nested too deeply instead of overflowing the stack", () => {
		const depth = 100_000;
		const input = `${"l".repeat(depth)}${"e".repeat(depth)}`;
		expect(() => decode(buf(input))).toThrow(/nested too deeply/);
	});

	it("accepts the nesting found in real torrents", () => {
		const depth = 64;
		const input = `${"l".repeat(depth)}${"e".repeat(depth)}`;
		expect(() => decode(buf(input))).not.toThrow();
	});
});

describe("encode", () => {
	it("encodes integers, byte strings, strings and booleans", () => {
		expect(encode(42)).toEqual(buf("i42e"));
		expect(encode(-3)).toEqual(buf("i-3e"));
		expect(encode(-0)).toEqual(buf("i0e"));
		expect(encode(Buffer.from([0xff, 0x00]))).toEqual(buf("2:\xff\x00"));
		expect(encode(new Uint8Array([1, 2, 3]))).toEqual(
			buf("3:\x01\x02\x03"),
		);
		expect(encode("é")).toEqual(Buffer.from("2:é"));
		expect(encode(true)).toEqual(buf("i1e"));
		expect(encode(false)).toEqual(buf("i0e"));
	});

	it("sorts dictionary keys by byte value", () => {
		expect(encode({ b: 1, a: 2, "\xff": 3, Z: 4, "": 5 })).toEqual(
			buf("d0:i5e1:Zi4e1:ai2e1:bi1e1:\xffi3ee"),
		);
	});

	it("writes dictionary keys as raw bytes", () => {
		const key = "\x80\x81\xfe";
		expect(encode({ [key]: 1 })).toEqual(buf("d3:\x80\x81\xfei1ee"));
	});

	it("skips null and undefined entries", () => {
		expect(encode({ a: 1, b: undefined, c: null })).toEqual(
			buf("d1:ai1ee"),
		);
		expect(encode([1, undefined, null, 2])).toEqual(buf("li1ei2ee"));
	});

	it("encodes nested structures", () => {
		expect(
			encode({ files: [{ length: 3, path: [Buffer.from("a")] }] }),
		).toEqual(buf("d5:filesld6:lengthi3e4:pathl1:aeeee"));
	});

	it.each([
		["a float", 1.5],
		["NaN", NaN],
		["Infinity", Infinity],
		["a number above 2^53", 2 ** 53],
		["a bigint", 1n],
		["a function", () => 1],
		["a symbol", Symbol("x")],
		["a key with characters above 0xff", { Ā: 1 }],
	])("refuses to encode %s", (_name, value) => {
		expect(() => encode(value)).toThrow();
	});

	it("refuses to encode a circular structure", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(() => encode(loop)).toThrow(/nested too deeply/);
	});
});

/** Small deterministic PRNG so failures are reproducible */
function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomValue(random: () => number, depth: number): unknown {
	const pick = random() * (depth > 3 ? 2 : 4);
	if (pick < 1) return Math.floor(random() * 2 ** 40) - 2 ** 39;
	if (pick < 2) {
		return Buffer.from(
			Array.from({ length: Math.floor(random() * 40) }, () =>
				Math.floor(random() * 256),
			),
		);
	}
	if (pick < 3) {
		return Array.from({ length: Math.floor(random() * 5) }, () =>
			randomValue(random, depth + 1),
		);
	}
	const dict: Record<string, unknown> = {};
	for (let i = Math.floor(random() * 5); i > 0; i--) {
		// binary keys, including empty ones and ones that look like lengths
		const key = Buffer.from(
			Array.from({ length: Math.floor(random() * 33) }, () =>
				Math.floor(random() * 256),
			),
		).toString("latin1");
		dict[key] = randomValue(random, depth + 1);
	}
	return dict;
}

describe("round trip", () => {
	it("decode(encode(x)) equals x, with arbitrary binary keys", () => {
		const random = mulberry32(1192);
		for (let i = 0; i < 500; i++) {
			const value = randomValue(random, 0);
			expect(decode(encode(value))).toEqual(value);
		}
	});

	it("encode(decode(x)) is the identity for canonical bencode", () => {
		const random = mulberry32(2026);
		for (let i = 0; i < 500; i++) {
			const canonical = encode(randomValue(random, 0));
			expect(encode(decode(canonical))).toEqual(canonical);
		}
	});

	it("normalises non canonical input", () => {
		// unsorted keys and a leading zero
		expect(encode(decode(buf("d1:bi01e1:ai2ee")))).toEqual(
			buf("d1:ai2e1:bi1ee"),
		);
	});
});

describe("compatibility with the bencode package", () => {
	const torrentLike = {
		announce: Buffer.from("https://tracker.example/announce"),
		"announce-list": [
			[Buffer.from("https://a.example/announce")],
			[Buffer.from("https://b.example/announce")],
		],
		comment: Buffer.from("héllo wörld"),
		info: {
			files: [
				{
					length: 1234,
					path: [Buffer.from("dir"), Buffer.from("日本語.mkv")],
				},
				{ length: 0, path: [Buffer.from("empty")] },
			],
			name: Buffer.from("Some.Release"),
			"name.utf-8": Buffer.from("Some.Release"),
			"piece length": 262144,
			pieces: Buffer.alloc(40, 7),
			private: 1,
		},
	};

	it("encodes the same bytes for text keyed data", () => {
		expect(encode(torrentLike)).toEqual(bencode.encode(torrentLike));
	});

	it("decodes the same data for text keyed data", () => {
		const encoded = bencode.encode(torrentLike);
		expect(decode(encoded)).toEqual(bencode.decode(encoded));
	});
});
