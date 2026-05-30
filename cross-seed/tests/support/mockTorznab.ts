import bencode from "bencode";
import Fastify, {
	type FastifyInstance,
	type FastifyReply,
	type FastifyRequest,
} from "fastify";
import { XMLBuilder } from "fast-xml-parser";

const builder = new XMLBuilder({
	ignoreAttributes: false,
	format: true,
	attributeNamePrefix: "@_",
});

type TorrentFile = { path: string; length: number };

export interface MockTorznabTorrent {
	id?: string;
	title: string;
	pubDate?: string | number | Date;
	size?: number;
	files?: TorrentFile[];
	tracker?: string;
	attributes?: Record<string, unknown>;
	guid?: string;
	link?: string;
	torrentName?: string;
}

export interface MockTorznabOptions {
	baseUrl?: string;
	torrents?: MockTorznabTorrent[];
	now?: number;
	logger?: boolean;
}

export interface MockTorznabState {
	baseUrl: string;
	now: number;
	torrents: StoredTorrent[];
	setTorrents: (torrents: MockTorznabTorrent[]) => void;
	setNow: (now: number) => void;
	resolveTorrents: (baseUrl?: string) => ResolvedTorrent[];
	resolveTorrentById: (
		id: string,
		baseUrl?: string,
	) => ResolvedTorrent | undefined;
}

type StoredTorrent = {
	id: string;
	title: string;
	guid?: string;
	link?: string;
	pubDate: string;
	size: number;
	files: TorrentFile[];
	torrentName: string;
	tracker: string;
	attributes: Record<string, unknown>;
};

type ResolvedTorrent = StoredTorrent & {
	guid: string;
	link: string;
	torrentPayload: Buffer;
};

function sumFileSizes(files: TorrentFile[]): number {
	return files.reduce((acc, file) => acc + file.length, 0);
}

function normalizePubDate(input: MockTorznabTorrent["pubDate"], now: number) {
	if (!input) return new Date(now).toUTCString();
	if (input instanceof Date) return input.toUTCString();
	if (typeof input === "number") return new Date(input).toUTCString();
	return new Date(input).toUTCString();
}

function normalizeFiles(
	torrent: MockTorznabTorrent,
	fallbackSize: number,
): TorrentFile[] {
	if (torrent.files && torrent.files.length) return torrent.files;
	return [{ path: `${torrent.title}.mkv`, length: fallbackSize }];
}

function buildTorrentPayload(
	torrentName: string,
	files: TorrentFile[],
	announceUrl: string,
): Buffer {
	const totalSize = sumFileSizes(files);
	const info: Record<string, unknown> = {
		name: Buffer.from(torrentName),
		"piece length": 262144,
		pieces: Buffer.alloc(20),
	};

	if (files.length === 1) {
		info.length = totalSize;
	} else {
		info.files = files.map((file) => ({
			length: file.length,
			path: file.path
				.split(/[/\\]+/)
				.map((segment) => Buffer.from(segment)),
		}));
	}

	const raw = {
		info,
		announce: Buffer.from(announceUrl),
	};

	return bencode.encode(raw);
}

function normalizeTorrents(
	torrents: MockTorznabTorrent[],
	now: number,
): StoredTorrent[] {
	return torrents.map((torrent, index) => {
		const id = torrent.id ?? String(index + 1);
		const fallbackSize = torrent.size ?? 734003200;
		const files = normalizeFiles(torrent, fallbackSize);
		const size = torrent.size ?? sumFileSizes(files);
		const torrentName = torrent.torrentName ?? torrent.title;
		const pubDate = normalizePubDate(torrent.pubDate, now - index * 1000);
		const tracker = torrent.tracker ?? "mock-torznab";
		const attributes = {
			seeders: 12,
			peers: 3,
			grabs: 42,
			...torrent.attributes,
		};

		return {
			id,
			title: torrent.title,
			guid: torrent.guid,
			link: torrent.link,
			pubDate,
			size,
			files,
			torrentName,
			tracker,
			attributes,
		};
	});
}

function getDefaultTorrents(query: string, now: number) {
	const normalizedQuery = query.trim()
		? query.trim().replace(/\s+/g, ".")
		: "test";
	return normalizeTorrents(
		Array.from({ length: 10 }, (_, index) => {
			const episode = String(index + 1).padStart(2, "0");
			return {
				title: `${normalizedQuery}.S01E${episode}.1080p.WEB-DL-GROUP`,
				id: String(index + 1),
			};
		}),
		now,
	);
}

function resolveTorrent(
	torrent: StoredTorrent,
	baseUrl: string,
): ResolvedTorrent {
	const guid = torrent.guid ?? `${baseUrl}/torrent/${torrent.id}`;
	const link = torrent.link ?? `${baseUrl}/download/${torrent.id}.torrent`;
	const torrentPayload = buildTorrentPayload(
		torrent.torrentName,
		torrent.files,
		`${baseUrl}/announce`,
	);

	return {
		...torrent,
		guid,
		link,
		torrentPayload,
	};
}

function toXmlSerializable(torrent: ResolvedTorrent) {
	return {
		title: torrent.title,
		guid: torrent.guid,
		link: torrent.link,
		comments: torrent.guid,
		pubDate: torrent.pubDate,
		size: torrent.size,
		description: "Mock torrent result",
		category: ["5000", "5040"],
		enclosure: {
			"@_url": torrent.link,
			"@_length": torrent.size,
			"@_type": "application/x-bittorrent",
		},
		"torznab:attr": Object.entries(torrent.attributes).map(
			([name, value]) => ({
				"@_name": name,
				"@_value": value,
			}),
		),
		indexer: {
			"@_id": "1",
			"#text": torrent.tracker,
		},
	};
}

function normalizeSearchToken(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveBaseUrl(
	request: FastifyRequest,
	fallbackBaseUrl: string,
): string {
	const forwardedProto = request.headers["x-forwarded-proto"];
	const forwardedHost = request.headers["x-forwarded-host"];
	const host = Array.isArray(forwardedHost)
		? forwardedHost[0]
		: forwardedHost || request.headers.host;
	if (!host) return fallbackBaseUrl;

	const fallback = new URL(fallbackBaseUrl);
	const protocolValue = Array.isArray(forwardedProto)
		? forwardedProto[0]
		: forwardedProto;
	const protocol = protocolValue || fallback.protocol.slice(0, -1);

	return `${protocol}://${host}`;
}

export function createMockTorznabServer(options: MockTorznabOptions = {}) {
	const baseUrl = options.baseUrl ?? "http://mock-torznab.local";
	const state: MockTorznabState = {
		baseUrl,
		now: options.now ?? Date.now(),
		torrents: [],
		setTorrents(torrents) {
			state.torrents = normalizeTorrents(torrents, state.now);
		},
		setNow(now) {
			state.now = now;
		},
		resolveTorrents(resolveBase = state.baseUrl) {
			return state.torrents.map((torrent) =>
				resolveTorrent(torrent, resolveBase),
			);
		},
		resolveTorrentById(id, resolveBase = state.baseUrl) {
			const torrent = state.torrents.find((entry) => entry.id === id);
			return torrent ? resolveTorrent(torrent, resolveBase) : undefined;
		},
	};
	state.setTorrents(options.torrents ?? []);

	const server: FastifyInstance = Fastify({
		logger: options.logger ?? false,
	});

	server.get(
		"/api",
		async (
			request: FastifyRequest<{
				Querystring: {
					t: string;
					q?: string;
					apikey?: string;
					limit?: string;
					offset?: string;
				};
			}>,
			reply: FastifyReply,
		) => {
			const { t, q } = request.query;
			const requestBaseUrl = resolveBaseUrl(request, state.baseUrl);

			if (t === "caps") {
				const caps = {
					"?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
					caps: {
						server: {
							"@_version": "1.0",
							"@_title": "Mock Torznab",
							"@_strapline": "A mock Torznab server",
							"@_email": "test@test.com",
							"@_url": requestBaseUrl,
						},
						limits: { "@_max": "100", "@_default": "50" },
						searching: {
							search: {
								"@_available": "yes",
								"@_supportedParams": "q",
							},
							"tv-search": {
								"@_available": "yes",
								"@_supportedParams": "q,season,ep",
							},
							"movie-search": {
								"@_available": "yes",
								"@_supportedParams": "q",
							},
						},
						categories: {
							category: [
								{ "@_id": "5000", "@_name": "TV" },
								{ "@_id": "5040", "@_name": "TV/HD" },
							],
						},
						tags: {
							tag: [
								{
									"@_name": "internal",
									"@_description":
										"Uploader is an internal release group",
								},
								{
									"@_name": "freeleech",
									"@_description":
										"Download doesn't count toward ratio",
								},
							],
						},
					},
				};
				return reply
					.header("Content-Type", "application/xml")
					.send(builder.build(caps));
			}

			if (t === "search" || t === "tvsearch" || t === "movie") {
				const limit = Number(request.query.limit ?? 100);
				const offset = Number(request.query.offset ?? 0);
				let allTorrents = state.torrents;
				if (!allTorrents.length) {
					allTorrents = getDefaultTorrents(q || "test", state.now);
					state.torrents = allTorrents;
				}
				const filtered = q
					? allTorrents.filter((torrent) =>
							normalizeSearchToken(torrent.title).includes(
								normalizeSearchToken(q),
							),
						)
					: allTorrents;
				const paged = filtered.slice(offset, offset + limit);
				const xmlTorrents = paged.map((torrent) =>
					toXmlSerializable(resolveTorrent(torrent, requestBaseUrl)),
				);
				const feed = {
					"?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
					rss: {
						"@_version": "1.0",
						"@_xmlns:atom": "http://www.w3.org/2005/Atom",
						"@_xmlns:torznab":
							"http://torznab.com/schemas/2015/feed",
						channel: {
							"atom:link": {
								"@_href": `${requestBaseUrl}/api?t=${t}&q=${encodeURIComponent(q || "")}`,
								"@_rel": "self",
								"@_type": "application/rss+xml",
							},
							title: "Mock Torznab",
							link: requestBaseUrl,
							description: "Mock Torznab feed",
							item: xmlTorrents,
						},
					},
				};
				return reply
					.header("Content-Type", "application/xml")
					.send(builder.build(feed));
			}

			return reply.code(404).send({ error: "Not found" });
		},
	);

	server.get(
		"/download/:id.torrent",
		async (
			request: FastifyRequest<{ Params: { id: string } }>,
			reply: FastifyReply,
		) => {
			const torrent = state.resolveTorrentById(
				request.params.id,
				resolveBaseUrl(request, state.baseUrl),
			);
			if (!torrent) {
				return reply.code(404).send({ error: "Torrent not found" });
			}
			return reply
				.header("Content-Type", "application/x-bittorrent")
				.send(torrent.torrentPayload);
		},
	);

	return { server, state };
}
