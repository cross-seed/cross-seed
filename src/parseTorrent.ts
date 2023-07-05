/*
 * The MIT License (MIT)
 *
 * Copyright (c) Feross Aboukhadijeh and WebTorrent, LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * 	subject to the following conditions:
 *
 * 	The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * 	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { encode as bencode, decode as bdecode } from "bencode";
import { createHash } from "crypto";
import { join } from "path";
import { File } from "./searchee.js";
import { fallback } from "./utils.js";

interface TorrentDirent {
	length: number;
	path?: Buffer[];
	"path.utf-8"?: Buffer[];
}

interface Torrent {
	info: {
		"name.utf-8"?: Buffer;
		name?: Buffer;

		"piece length": number;
		pieces: Buffer;

		files?: TorrentDirent[];
		length?: number;

		private: number;
	};
	comment: Buffer | string;
	announce: Buffer;
	"announce-list": Buffer[][];
}

export class Metafile {
	infoHash: string;
	length: number;
	name: string;
	pieceLength: number;
	files: File[];
	isSingleFileTorrent: boolean;
	raw: Torrent;

	constructor(raw: Torrent) {
		ensure(raw.info, "info");
		ensure(raw.info["name.utf-8"] || raw.info.name, "info.name");
		ensure(raw.info["piece length"], "info['piece length']");
		ensure(raw.info.pieces, "info.pieces");

		if (raw.info.files) {
			raw.info.files.forEach((file) => {
				ensure(typeof file.length === "number", "info.files[0].length");
				ensure(file["path.utf-8"] || file.path, "info.files[0].path");
			});
		} else {
			ensure(typeof raw.info.length === "number", "info.length");
		}

		this.raw = raw;
		this.infoHash = sha1(bencode(raw.info));
		this.name = fallback(raw.info["name.utf-8"], raw.info.name).toString();
		this.pieceLength = raw.info["piece length"];

		if (!raw.info.files) {
			this.files = [
				{
					name: this.name,
					path: this.name,
					length: raw.info.length,
				},
			];
			this.length = raw.info.length;
			this.isSingleFileTorrent = true;
		} else {
			this.files = raw.info.files
				.map((file) => {
					const rawPathSegments: Buffer[] = fallback(
						file["path.utf-8"],
						file.path
					);
					const pathSegments = rawPathSegments.map((buf) => {
						const seg = buf.toString();
						// convention for zero-length path segments is to treat them as underscores
						return seg === "" ? "_" : seg;
					});
					return {
						name: pathSegments[pathSegments.length - 1],
						length: file.length,
						path: join(this.name, ...pathSegments),
					};
				})
				.sort((a, b) => a.path.localeCompare(b.path));

			this.length = this.files.reduce(sumLength, 0);
			this.isSingleFileTorrent = false;
		}
	}

	static decode(buf: Buffer) {
		return new Metafile(bdecode(buf));
	}

	encode(): Buffer {
		return bencode(this.raw);
	}
}

function sumLength(sum: number, file: { length: number }): number {
	return sum + file.length;
}

function ensure(bool, fieldName) {
	if (!bool)
		throw new Error(`Torrent is missing required field: ${fieldName}`);
}

function sha1(buf: Buffer): string {
	const hash = createHash("sha1");
	hash.update(buf);
	return hash.digest("hex");
}
