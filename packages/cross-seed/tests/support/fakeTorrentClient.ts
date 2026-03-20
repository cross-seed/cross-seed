import Fastify, { type FastifyInstance } from "fastify";
import { Label } from "../../src/logger.js";
import type {
	ClientSearcheeResult,
	TorrentClient,
	TorrentMetadataInClient,
} from "../../src/clients/TorrentClient.js";
import {
	Decision,
	DecisionAnyMatch,
	InjectionResult,
} from "../../src/constants.js";
import { Result, resultOf, resultOfErr } from "../../src/Result.js";
import type { Metafile } from "../../src/parseTorrent.js";
import type { Searchee, SearcheeWithInfoHash } from "../../src/searchee.js";

export type FakeTorrent = {
	infoHash: string;
	name: string;
	savePath: string;
	files: { path: string; length: number }[];
	trackers?: string[];
	category?: string;
	tags?: string[];
	complete: boolean;
	checking: boolean;
};

export type FakeTorrentClientState = {
	torrents: Map<string, FakeTorrent>;
	addTorrent: (
		torrent: Omit<FakeTorrent, "checking"> & { checking?: boolean },
	) => void;
	reset: () => void;
};

export function createFakeTorrentClientServer() {
	const server: FastifyInstance = Fastify({ logger: false });
	const state: FakeTorrentClientState = {
		torrents: new Map(),
		addTorrent(torrent) {
			state.torrents.set(torrent.infoHash, {
				checking: false,
				...torrent,
			});
		},
		reset() {
			state.torrents.clear();
		},
	};

	server.get("/torrents", async () => {
		return Array.from(state.torrents.values());
	});

	server.get("/torrents/:infoHash", async (request, reply) => {
		const torrent = state.torrents.get(
			(request.params as { infoHash: string }).infoHash,
		);
		if (!torrent) {
			return reply.code(404).send({ error: "Not found" });
		}
		return torrent;
	});

	server.post("/torrents", async (request) => {
		const payload = request.body as FakeTorrent;
		state.addTorrent(payload);
		return { ok: true };
	});

	server.post("/torrents/:infoHash/recheck", async (request, reply) => {
		const hash = (request.params as { infoHash: string }).infoHash;
		const torrent = state.torrents.get(hash);
		if (!torrent) {
			return reply.code(404).send({ error: "Not found" });
		}
		torrent.checking = true;
		torrent.complete = true;
		return { ok: true };
	});

	server.post("/torrents/:infoHash/resume", async (request, reply) => {
		const hash = (request.params as { infoHash: string }).infoHash;
		const torrent = state.torrents.get(hash);
		if (!torrent) {
			return reply.code(404).send({ error: "Not found" });
		}
		torrent.checking = false;
		return { ok: true };
	});

	return { server, state };
}

async function parseJson<T>(responseText?: string): Promise<T | undefined> {
	if (!responseText) return undefined;
	return JSON.parse(responseText) as T;
}

export class FakeTorrentClient implements TorrentClient {
	readonly clientHost: string;
	readonly clientPriority: number;
	readonly clientType = Label.QBITTORRENT;
	readonly readonly: boolean;
	readonly label: string;

	constructor(
		private readonly server: FastifyInstance,
		clientHost = "fake-torrent-client",
		priority = 0,
		readonly = false,
	) {
		this.clientHost = clientHost;
		this.clientPriority = priority;
		this.readonly = readonly;
		this.label = `fake@${clientHost}`;
	}

	private async request<T>(
		method: "GET" | "POST",
		url: string,
		payload?: unknown,
	): Promise<{ status: number; body?: T }> {
		const res = await this.server.inject({
			method,
			url,
			payload: payload ? JSON.stringify(payload) : undefined,
			headers: payload
				? { "content-type": "application/json" }
				: undefined,
		});
		const body = await parseJson<T>(res.payload);
		return { status: res.statusCode, body };
	}

	async isTorrentInClient(infoHash: string): Promise<Result<boolean, Error>> {
		const res = await this.request<FakeTorrent>(
			"GET",
			`/torrents/${infoHash}`,
		);
		return resultOf(res.status === 200);
	}

	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const res = await this.request<FakeTorrent>(
			"GET",
			`/torrents/${infoHash}`,
		);
		if (res.status !== 200 || !res.body) return resultOfErr("NOT_FOUND");
		return resultOf(res.body.complete);
	}

	async isTorrentChecking(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const res = await this.request<FakeTorrent>(
			"GET",
			`/torrents/${infoHash}`,
		);
		if (res.status !== 200 || !res.body) return resultOfErr("NOT_FOUND");
		return resultOf(res.body.checking);
	}

	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const res = await this.request<FakeTorrent[]>("GET", "/torrents");
		return (res.body ?? []).map((torrent) => ({
			infoHash: torrent.infoHash,
			category: torrent.category,
			tags: torrent.tags,
			trackers: torrent.trackers,
		}));
	}

	async getClientSearchees(): Promise<ClientSearcheeResult> {
		return { searchees: [], newSearchees: [] };
	}

	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<
			string,
			| "NOT_FOUND"
			| "TORRENT_NOT_COMPLETE"
			| "INVALID_DATA"
			| "UNKNOWN_ERROR"
		>
	> {
		const res = await this.request<FakeTorrent>(
			"GET",
			`/torrents/${meta.infoHash}`,
		);
		if (res.status !== 200 || !res.body) return resultOfErr("NOT_FOUND");
		if (options.onlyCompleted && !res.body.complete) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		return resultOf(res.body.savePath);
	}

	async getAllDownloadDirs(options: {
		metas: SearcheeWithInfoHash[] | Metafile[];
		onlyCompleted: boolean;
		v1HashOnly?: boolean | undefined;
	}): Promise<Map<string, string>> {
		const res = await this.request<FakeTorrent[]>("GET", "/torrents");
		const map = new Map<string, string>();
		for (const torrent of res.body ?? []) {
			if (options.onlyCompleted && !torrent.complete) continue;
			map.set(torrent.infoHash, torrent.savePath);
		}
		return map;
	}

	async resumeInjection(
		meta: Metafile,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	): Promise<void> {
		void decision;
		void options;
		await this.request("POST", `/torrents/${meta.infoHash}/resume`);
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		options: { onlyCompleted: boolean; destinationDir?: string },
	): Promise<InjectionResult> {
		const res = await this.request<FakeTorrent>(
			"GET",
			`/torrents/${newTorrent.infoHash}`,
		);
		if (res.status === 200) return InjectionResult.ALREADY_EXISTS;

		const savePath =
			options.destinationDir ?? searchee.savePath ?? "/downloads";
		await this.request("POST", "/torrents", {
			infoHash: newTorrent.infoHash,
			name: newTorrent.name,
			files: newTorrent.files,
			savePath,
			trackers: newTorrent.trackers,
			category: newTorrent.category,
			tags: newTorrent.tags,
			complete: decision !== Decision.MATCH_PARTIAL,
			checking: false,
		} satisfies FakeTorrent);
		return InjectionResult.SUCCESS;
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		await this.request("POST", `/torrents/${infoHash}/recheck`);
	}

	async validateConfig(): Promise<void> {
		return;
	}
}
