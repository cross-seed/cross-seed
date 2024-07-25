import bencode from "bencode";
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

function sumLength(sum: number, file: { length: number }): number {
	return sum + file.length;
}

function ensure(bool: unknown, fieldName: string) {
	if (!bool)
		throw new Error(`Torrent is missing required field: ${fieldName}`);
}

function sha1(buf: Buffer): string {
	const hash = createHash("sha1");
	hash.update(buf);
	return hash.digest("hex");
}

export class Metafile {
	infoHash: string;
	length: number;
	name: string;
	/**
	 * Always name, exists for compatibility with Searchee
	 */
	title: string;
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
		this.infoHash = sha1(bencode.encode(raw.info));
		this.name = fallback(raw.info["name.utf-8"], raw.info.name)!.toString();
		this.title = this.name;
		this.pieceLength = raw.info["piece length"];

		if (!raw.info.files) {
			// length exists if files doesn't exist
			const length = raw.info.length!;
			this.files = [
				{
					name: this.name,
					path: this.name,
					length: length,
				},
			];
			this.length = length;
			this.isSingleFileTorrent = true;
		} else {
			this.files = raw.info.files
				.map((file) => {
					const rawPathSegments: Buffer[] = fallback(
						file["path.utf-8"],
						file.path,
					)!;
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
		return new Metafile(bencode.decode(buf));
	}
	getFileSystemSafeName(): string {
		return this.name.replace("/", "");
	}

	encode(): Buffer {
		return bencode.encode(this.raw);
	}
}
