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

import bencode from "bencode";
import { Metafile } from "parse-torrent";
import path from "path";

interface Torrent {
	info: {
		"name.utf-8"?: Buffer;
		name?: Buffer;

		"piece length": number;
		pieces: Buffer;

		files?: {
			length: number;
			path?: Buffer[];
			"path.utf-8"?: Buffer[];
		}[];
		length?: number;

		private: number;
	};
	comment: Buffer;
	announce: Buffer;
	"announce-list": Buffer[][];
}

function decodeTorrentFile(torrent: Buffer | Torrent): Metafile {
	if (Buffer.isBuffer(torrent)) {
		torrent = bencode.decode(torrent) as Torrent;
	}

	// sanity check
	ensure(torrent.info, "info");
	ensure(torrent.info["name.utf-8"] || torrent.info.name, "info.name");
	ensure(torrent.info["piece length"], "info['piece length']");
	ensure(torrent.info.pieces, "info.pieces");

	if (torrent.info.files) {
		torrent.info.files.forEach((file) => {
			ensure(typeof file.length === "number", "info.files[0].length");
			ensure(file["path.utf-8"] || file.path, "info.files[0].path");
		});
	} else {
		ensure(typeof torrent.info.length === "number", "info.length");
	}

	const result: Metafile = {
		info: torrent.info,
		infoBuffer: bencode.encode(torrent.info),
		name: (torrent.info["name.utf-8"] || torrent.info.name).toString(),
		announce: [],
	};

	result.infoHash = sha1.sync(result.infoBuffer);
	result.infoHashBuffer = Buffer.from(result.infoHash, "hex");

	if (torrent.info.private !== undefined)
		result.private = !!torrent.info.private;

	if (torrent["creation date"])
		result.created = new Date(torrent["creation date"] * 1000);
	if (torrent["created by"])
		result.createdBy = torrent["created by"].toString();

	if (Buffer.isBuffer(torrent.comment))
		result.comment = torrent.comment.toString();

	// announce and announce-list will be missing if metadata fetched via ut_metadata
	if (
		Array.isArray(torrent["announce-list"]) &&
		torrent["announce-list"].length > 0
	) {
		torrent["announce-list"].forEach((urls) => {
			urls.forEach((url) => {
				result.announce.push(url.toString());
			});
		});
	} else if (torrent.announce) {
		result.announce.push(torrent.announce.toString());
	}

	// handle url-list (BEP19 / web seeding)
	if (Buffer.isBuffer(torrent["url-list"])) {
		// some clients set url-list to empty string
		torrent["url-list"] =
			torrent["url-list"].length > 0 ? [torrent["url-list"]] : [];
	}
	result.urlList = (torrent["url-list"] || []).map((url) => url.toString());

	// remove duplicates by converting to Set and back
	result.announce = Array.from(new Set(result.announce));
	result.urlList = Array.from(new Set(result.urlList));

	const files = torrent.info.files || [torrent.info];
	result.files = files.map((file, i) => {
		const parts = []
			.concat(result.name, file["path.utf-8"] || file.path || [])
			.map((p) => p.toString());
		return {
			path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
			name: parts[parts.length - 1],
			length: file.length,
			offset: files.slice(0, i).reduce(sumLength, 0),
		};
	});

	result.length = files.reduce(sumLength, 0);

	const lastFile = result.files[result.files.length - 1];

	result.pieceLength = torrent.info["piece length"];
	result.lastPieceLength =
		(lastFile.offset + lastFile.length) % result.pieceLength ||
		result.pieceLength;
	result.pieces = splitPieces(torrent.info.pieces);

	return result;
}

function encodeTorrentFile(parsed: Metafile): Buffer {
	const torrent = {
		info: parsed.info,
	};

	torrent["announce-list"] = (parsed.announce || []).map((url) => {
		if (!torrent.announce) torrent.announce = url;
		url = Buffer.from(url, "utf8");
		return [url];
	});

	torrent["url-list"] = parsed.urlList || [];

	if (parsed.private !== undefined) {
		torrent.private = Number(parsed.private);
	}

	if (parsed.created) {
		torrent["creation date"] = (parsed.created.getTime() / 1000) | 0;
	}

	if (parsed.createdBy) {
		torrent["created by"] = parsed.createdBy;
	}

	if (parsed.comment) {
		torrent.comment = parsed.comment;
	}

	console.log(torrent.announce);
	console.log(torrent["announce-list"]);

	return bencode.encode(torrent);
}

function sumLength(sum, file) {
	return sum + file.length;
}

function splitPieces(buf) {
	const pieces = [];
	for (let i = 0; i < buf.length; i += 20) {
		pieces.push(buf.slice(i, i + 20).toString("hex"));
	}
	return pieces;
}

function ensure(bool, fieldName) {
	if (!bool)
		throw new Error(`Torrent is missing required field: ${fieldName}`);
}
