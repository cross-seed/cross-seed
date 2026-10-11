/**
 * A lossless bencode codec.
 *
 * The `bencode` package decodes dictionary keys into UTF-8 strings and encodes
 * them back the same way. Keys that are not valid UTF-8 are therefore replaced
 * with U+FFFD, and `encode(decode(x))` no longer equals `x`. Hybrid (v1 + v2,
 * BEP 52) torrents hit this: their top level `piece layers` dictionary is keyed
 * by raw 32 byte merkle roots.
 *
 * Representation:
 * - byte strings are `Buffer`s. When decoding, they are views into the input
 *   (not copies), so don't mutate the input afterwards.
 * - integers are `number`s. Only safe integers are supported.
 * - lists are arrays.
 * - dictionaries are plain objects. Their keys are "binary strings": every
 *   character stands for exactly one byte (latin1). Keys that cross-seed reads
 *   are ASCII so they behave as usual, while keys that aren't text survive a
 *   round trip untouched.
 *
 * `encode(decode(x))` returns `x` for any canonical bencode (sorted keys, no
 * leading zeros), which is what torrent clients write. Non canonical input is
 * normalised: keys get sorted and leading zeros are dropped.
 */

export type BencodeValue = number | Buffer | BencodeValue[] | BencodeDict;
export interface BencodeDict {
	[key: string]: BencodeValue;
}

// Real torrents nest a handful of levels. This only stops hostile input
const MAX_DEPTH = 256;

const CHAR_0 = 0x30;
const CHAR_9 = 0x39;
const CHAR_MINUS = 0x2d;
const CHAR_COLON = 0x3a;
const CHAR_D = 0x64;
const CHAR_E = 0x65;
const CHAR_I = 0x69;
const CHAR_L = 0x6c;

function isDigit(byte: number): boolean {
	return byte >= CHAR_0 && byte <= CHAR_9;
}

class Decoder {
	private pos = 0;

	constructor(private readonly buf: Buffer) {}

	decode(): BencodeValue {
		return this.readValue(0);
	}

	private fail(message: string): never {
		throw new Error(`Invalid bencode at byte ${this.pos}: ${message}`);
	}

	private peek(): number {
		if (this.pos >= this.buf.length) this.fail("unexpected end of data");
		return this.buf[this.pos];
	}

	private readValue(depth: number): BencodeValue {
		const byte = this.peek();
		if (isDigit(byte)) return this.readBytes();
		if (byte !== CHAR_I && byte !== CHAR_L && byte !== CHAR_D) {
			this.fail(`unexpected byte 0x${byte.toString(16)}`);
		}
		if (depth >= MAX_DEPTH) this.fail("nested too deeply");
		if (byte === CHAR_I) return this.readInteger();
		if (byte === CHAR_L) return this.readList(depth);
		return this.readDict(depth);
	}

	private readInteger(): number {
		this.pos++; // i
		let negative = false;
		if (this.peek() === CHAR_MINUS) {
			negative = true;
			this.pos++;
		}
		if (!isDigit(this.peek())) this.fail("expected digits in integer");
		let value = 0;
		while (isDigit(this.peek())) {
			value = value * 10 + (this.buf[this.pos++] - CHAR_0);
			if (value > Number.MAX_SAFE_INTEGER) {
				this.fail("integer exceeds the safe integer range");
			}
		}
		if (this.peek() !== CHAR_E) this.fail("expected 'e' after integer");
		this.pos++;
		return negative && value !== 0 ? -value : value;
	}

	private readBytes(): Buffer {
		let length = 0;
		while (isDigit(this.peek())) {
			length = length * 10 + (this.buf[this.pos++] - CHAR_0);
			if (length > this.buf.length) this.fail("string is too long");
		}
		if (this.peek() !== CHAR_COLON) this.fail("expected ':' after length");
		this.pos++;
		const end = this.pos + length;
		if (end > this.buf.length) this.fail("string is truncated");
		const bytes = this.buf.subarray(this.pos, end);
		this.pos = end;
		return bytes;
	}

	private readList(depth: number): BencodeValue[] {
		this.pos++; // l
		const list: BencodeValue[] = [];
		while (this.peek() !== CHAR_E) list.push(this.readValue(depth + 1));
		this.pos++;
		return list;
	}

	private readDict(depth: number): BencodeDict {
		this.pos++; // d
		const dict: BencodeDict = {};
		while (this.peek() !== CHAR_E) {
			if (!isDigit(this.peek()))
				this.fail("dictionary key must be a string");
			const key = this.readBytes().toString("latin1");
			const value = this.readValue(depth + 1);
			if (key === "__proto__") {
				// a plain assignment would replace the prototype
				Object.defineProperty(dict, key, {
					value,
					enumerable: true,
					writable: true,
					configurable: true,
				});
			} else {
				dict[key] = value;
			}
		}
		this.pos++;
		return dict;
	}
}

/**
 * Decodes the first bencoded value in `data`. Bytes after it are ignored.
 * Throws if `data` is empty or malformed. The result is typed `unknown` since
 * its shape comes from untrusted data: validate it before relying on it.
 */
export function decode(data: Uint8Array): unknown {
	const buf = Buffer.isBuffer(data)
		? data
		: Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	return new Decoder(buf).decode();
}

const LIST_TOKEN = Buffer.from("l");
const DICT_TOKEN = Buffer.from("d");
const END_TOKEN = Buffer.from("e");

/** Whether every character fits in a byte, as keys must (see the header) */
function isByteString(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) > 0xff) return false;
	}
	return true;
}

function encodeInto(chunks: Buffer[], value: unknown, depth: number): void {
	if (depth > MAX_DEPTH) {
		throw new Error("Cannot bencode: value is nested too deeply");
	}
	if (Buffer.isBuffer(value)) {
		chunks.push(Buffer.from(`${value.length}:`, "latin1"), value);
	} else if (ArrayBuffer.isView(value)) {
		const bytes = Buffer.from(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		);
		chunks.push(Buffer.from(`${bytes.length}:`, "latin1"), bytes);
	} else if (typeof value === "string") {
		const bytes = Buffer.from(value, "utf8");
		chunks.push(Buffer.from(`${bytes.length}:`, "latin1"), bytes);
	} else if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new Error(`Cannot bencode non-integer number: ${value}`);
		}
		chunks.push(Buffer.from(`i${value}e`, "latin1"));
	} else if (typeof value === "boolean") {
		chunks.push(Buffer.from(value ? "i1e" : "i0e", "latin1"));
	} else if (Array.isArray(value)) {
		chunks.push(LIST_TOKEN);
		for (const item of value as unknown[]) {
			if (item == null) continue;
			encodeInto(chunks, item, depth + 1);
		}
		chunks.push(END_TOKEN);
	} else if (typeof value === "object" && value !== null) {
		const dict = value as Record<string, unknown>;
		chunks.push(DICT_TOKEN);
		// Keys hold one byte per character, so code unit order is byte order
		for (const key of Object.keys(dict).sort()) {
			const item = dict[key];
			if (item == null) continue;
			if (!isByteString(key)) {
				throw new Error(
					`Cannot bencode dictionary key with characters above 0xff: ${JSON.stringify(key)}`,
				);
			}
			chunks.push(Buffer.from(`${key.length}:${key}`, "latin1"));
			encodeInto(chunks, item, depth + 1);
		}
		chunks.push(END_TOKEN);
	} else {
		throw new Error(`Cannot bencode value of type ${typeof value}`);
	}
}

/**
 * Encodes `value` as bencode. Besides what `decode` returns, strings (as
 * UTF-8), typed arrays and booleans (as 1 or 0) are accepted. `null` and
 * `undefined` entries in dictionaries and lists are skipped.
 */
export function encode(value: unknown): Buffer {
	const chunks: Buffer[] = [];
	encodeInto(chunks, value, 0);
	return Buffer.concat(chunks);
}
