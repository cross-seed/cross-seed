import bencode from "bencode";
import { createHash } from "crypto";
import { join } from "path";
import { File, parseTitle } from "./searchee.js";
import { fallback, isTruthy } from "./utils.js";

interface TorrentDirent {
	length: number;
	path?: Buffer[];
	"path.utf-8"?: Buffer[];
}

export interface Torrent {
	info: {
		"name.utf-8"?: Buffer;
		name?: Buffer;

		"piece length": number;
		pieces: Buffer;

		files?: TorrentDirent[];
		length?: number;

		private: number;
	};
	// qBittorrent only keeps info dict, everything else in fastresume
	comment?: Buffer | string;
	announce?: Buffer;
	"announce-list"?: Buffer[][];
}

/**
 * "Fastresume" for all clients. Used to get torrent info.
 * qBittorrent: .fastresume, Transmission: .resume, rTorrent: .rtorrent
 * Deluge doesn't store labels in fastresume, but in label.conf
 */
interface TorrentMetadata {
	trackers?: Buffer[][];
	"qBt-category"?: Buffer;
	"qBt-tags"?: Buffer;
}

export function updateMetafileMetadata(
	metafile: Metafile,
	metadata: TorrentMetadata,
): void {
	if (metadata["qBt-category"]) {
		metafile.category = metadata["qBt-category"].toString();
	}
	if (metadata["qBt-tags"]) {
		metafile.tags = metadata["qBt-tags"].toString().split(",");
	}
	if (metadata.trackers) {
		metafile.trackers = metadata.trackers
			.map((tier) => sanitizeTrackerUrls(tier))
			.flat();
	}
}

export function sanitizeTrackerUrl(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

function sanitizeTrackerUrls(urls: Buffer[]): string[] {
	return urls
		.map((url) => sanitizeTrackerUrl(url.toString()))
		.filter(isTruthy);
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
	hash.update(new Uint8Array(buf));
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
	category?: string;
	tags: string[];
	trackers: string[];
	linkdirTracker: string;
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
		this.title = parseTitle(this.name, this.files) ?? this.name;

		const announceList = raw["announce-list"];
		this.trackers =
			Array.isArray(announceList) && announceList.length > 0
				? announceList.map((tier) => sanitizeTrackerUrls(tier)).flat()
				: raw.announce
					? sanitizeTrackerUrls([raw.announce])
					: [];
	}

	static decode(buf: Buffer) {
		const tracker_keys = {
			"ther.cc": "aither",
			"ratio.cc": "alpharatio",
			"lion.me": "anthelion",
			"hd.me": "beyondhd",
			"pia.cc": "blutopia",
			"list.io": "filelist",
			thefl: "filelist",
			"its.org": "hdbits",
			"of.tv": "broadcasthenet",
			lst: "lst",
			"ntv.me": "morethantv",
			"lance.io": "nebulance",
			only: "onlyencodes",
			"orn.me": "passthepopcorn",
			seedpool: "seedpool",
			"tv-v": "tvvault",
			upload: "ulcx",
		};
		const meta = new Metafile(bencode.decode(buf));

		const y = meta.trackers.toString();

		for (const key in tracker_keys) {
			if (y.includes(key)) {
				meta.linkdirTracker = tracker_keys[key];
			}
		}
		if (!meta.linkdirTracker === undefined) {
			meta.linkdirTracker = "unknown";
		}
		console.log(meta.linkdirTracker);
		return meta;
	}

	getFileSystemSafeName(): string {
		return this.name.replace("/", "");
	}

	encode(): Buffer {
		return bencode.encode(this.raw);
	}
}
