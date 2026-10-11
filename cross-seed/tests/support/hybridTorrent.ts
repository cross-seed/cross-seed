/**
 * Builds a hybrid (v1 + v2, BEP 52) torrent by concatenating bytes by hand, so
 * tests don't depend on the bencode code they are checking.
 *
 * Its `piece layers` dictionary is keyed by a 32 byte merkle root, which is
 * binary data and not valid UTF-8, like in real hybrid torrents.
 */

function bytes(value: Buffer | string): Buffer {
	const buf = typeof value === "string" ? Buffer.from(value) : value;
	return Buffer.concat([Buffer.from(`${buf.length}:`), buf]);
}

function int(value: number): Buffer {
	return Buffer.from(`i${value}e`);
}

function dict(entries: [string | Buffer, Buffer][]): Buffer {
	return Buffer.concat([
		Buffer.from("d"),
		...entries.flatMap(([key, value]) => [bytes(key), value]),
		Buffer.from("e"),
	]);
}

export interface HybridTorrent {
	/** The whole .torrent file */
	torrent: Buffer;
	/** The bencoded info dictionary, exactly as it appears in `torrent` */
	info: Buffer;
	/** The binary key of the `piece layers` dictionary */
	piecesRoot: Buffer;
	pieceLayer: Buffer;
	name: string;
	length: number;
	announce: string;
}

export function buildHybridTorrent(
	options: { announce?: string } = {},
): HybridTorrent {
	const announce = options.announce ?? "https://tracker.example/announce";
	const name = "Show.Name.S01E01.1080p.WEB-DL-GROUP.mkv";
	const length = 32768;
	const pieceLength = 16384;
	const piecesRoot = Buffer.from(
		Array.from({ length: 32 }, (_, i) => (0x80 + i * 7) & 0xff),
	);
	const pieceLayer = Buffer.from(
		Array.from({ length: 64 }, (_, i) => (0xc0 + i * 3) & 0xff),
	);

	// keys are listed in byte order, as bencode requires
	const info = dict([
		[
			"file tree",
			dict([
				[
					name,
					dict([
						[
							"",
							dict([
								["length", int(length)],
								["pieces root", bytes(piecesRoot)],
							]),
						],
					]),
				],
			]),
		],
		["length", int(length)],
		["meta version", int(2)],
		["name", bytes(name)],
		["piece length", int(pieceLength)],
		["pieces", bytes(Buffer.alloc(40, 0xab))],
	]);
	const torrent = dict([
		["announce", bytes(announce)],
		["info", info],
		["piece layers", dict([[piecesRoot, bytes(pieceLayer)]])],
	]);
	return { torrent, info, piecesRoot, pieceLayer, name, length, announce };
}
