/* eslint-disable no-unused-vars */

declare module "parse-torrent" {
	export = ParseTorrent;
	function ParseTorrent(torrentId: Buffer): ParseTorrent.Metafile;
	namespace ParseTorrent {
		function remote(
			torrentId: string,
			opts: unknown,
			cb: (error: unknown, torrent: Metafile) => void
		): void;

		function toMagnetURI(obj: Metafile): string;

		function toTorrentFile(parsed: Metafile): Buffer;
		export interface FileListing {
			length: number;
			name: string;
			offset: number;
			path: string;
			pathSegments: string[];
		}

		export interface Metafile {
			announce: string[];
			created: string;
			createdBy: string;
			files: FileListing[];
			info: {
				files: {
					length: number;
					path: Buffer[];
				}[];
				name: Buffer;
				"piece length": number;
				pieces: Buffer;
				private: number;
			};
			infoBuffer: Buffer;
			infoHash: string;
			infoHashBuffer: Buffer;
			lastPieceLength: number;
			length: number;
			name: string;
			pieceLength: number;
			pieces: string[];
			private: boolean;
			urlList: string[];
		}
	}
}
