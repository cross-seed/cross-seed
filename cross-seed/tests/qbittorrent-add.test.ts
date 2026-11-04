import { afterEach, describe, expect, it, vi } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";
import { Decision, InjectionResult } from "../src/constants.js";
import { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";

const logs = vi.hoisted(() => ({
	verbose: vi.fn(),
	error: vi.fn<(entry: { message: string }) => void>(),
	debug: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
	Label: { QBITTORRENT: "qbittorrent" },
	logger: logs,
}));

function errors(): string {
	return logs.error.mock.calls.map(([entry]) => entry.message).join("\n");
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const meta = new Metafile({
	info: {
		name: Buffer.from("Synthetic.Movie.2026.mkv"),
		length: 1,
		"piece length": 16384,
		pieces: Buffer.alloc(20, 1),
		private: 1,
	},
});

function setup(add: () => Response | Promise<Response>, added = false) {
	vi.useFakeTimers();
	setRuntimeConfig({
		...getRuntimeConfig(),
		skipRecheck: true,
		linkCategory: "",
	});
	let addAttempts = 0;
	let polls = 0;
	const fetchMock = vi.fn((url: string) => {
		const endpoint = new URL(url).pathname;
		if (endpoint.endsWith("/torrents/add")) {
			addAttempts++;
			return Promise.resolve().then(add);
		}
		if (endpoint.endsWith("/torrents/info")) {
			if (addAttempts) polls++;
			return Promise.resolve(
				Response.json(
					addAttempts && added ? [{ hash: meta.infoHash }] : [],
				),
			);
		}
		throw new Error(`Unexpected request: ${endpoint}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	const qb = new QBittorrent(
		"http://user:pass@localhost:8080",
		"test-client",
		0,
		false,
	);
	qb.cookie = "SID=test";
	qb.versionMajor = 5;
	qb.versionMinor = 3;
	return {
		async inject() {
			const pending = qb.inject(
				meta,
				{
					name: meta.name,
					title: meta.title,
					length: meta.length,
					files: meta.files,
				},
				Decision.MATCH,
				{ onlyCompleted: true, destinationDir: "/downloads" },
			);
			await vi.runAllTimersAsync();
			return pending;
		},
		addAttempts: () => addAttempts,
		polls: () => polls,
	};
}

describe("qBittorrent add rejection diagnostics", () => {
	it("reports HTTP 415 and the client's explanation without retrying or polling", async () => {
		const test = setup(
			() =>
				new Response(
					"Error: 'synthetic.torrent' is not a valid torrent file.",
					{
						status: 415,
					},
				),
		);
		expect(await test.inject()).toBe(InjectionResult.FAILURE);
		expect(test.addAttempts()).toBe(1);
		expect(test.polls()).toBe(0);
		expect(errors()).toContain(
			"HTTP 415: Error: 'synthetic.torrent' is not a valid torrent file.",
		);
	});

	it("includes HTTP 415 even when the response body is empty", async () => {
		const test = setup(() => new Response("", { status: 415 }));
		expect(await test.inject()).toBe(InjectionResult.FAILURE);
		expect(test.polls()).toBe(0);
		expect(errors()).toContain("HTTP 415");
	});

	it("reports a conflict but still reconciles an already-added torrent", async () => {
		const test = setup(
			() => new Response("Conflict", { status: 409 }),
			true,
		);
		expect(await test.inject()).toBe(InjectionResult.SUCCESS);
		expect(test.addAttempts()).toBe(1);
		expect(test.polls()).toBeGreaterThan(0);
		expect(errors()).toContain("HTTP 409: Conflict");
	});

	it("reports the legacy Fails response and still reconciles", async () => {
		const test = setup(() => new Response("Fails."), true);
		expect(await test.inject()).toBe(InjectionResult.SUCCESS);
		expect(test.polls()).toBeGreaterThan(0);
		expect(errors()).toContain("Fails.");
	});

	it.each(["Ok.", JSON.stringify({ success_count: 1, failure_count: 0 })])(
		"confirms the addition after a successful response %s",
		async (body) => {
			const test = setup(() => new Response(body), true);
			expect(await test.inject()).toBe(InjectionResult.SUCCESS);
			expect(test.polls()).toBeGreaterThan(0);
			expect(logs.error).not.toHaveBeenCalled();
		},
	);

	it("reconciles after a lost response even when every add retry fails", async () => {
		const test = setup(() => {
			throw new TypeError("fetch failed");
		}, true);
		expect(await test.inject()).toBe(InjectionResult.SUCCESS);
		expect(test.addAttempts()).toBe(4);
		expect(test.polls()).toBeGreaterThan(0);
	});

	it("retries broken response bodies and still reconciles", async () => {
		const test = setup(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new TypeError("terminated"));
						},
					}),
				),
			true,
		);
		expect(await test.inject()).toBe(InjectionResult.SUCCESS);
		expect(test.addAttempts()).toBe(4);
		expect(test.polls()).toBeGreaterThan(0);
	});

	it("retains reconciliation after repeated server errors", async () => {
		const test = setup(
			() => new Response("Unavailable", { status: 503 }),
			true,
		);
		expect(await test.inject()).toBe(InjectionResult.SUCCESS);
		expect(test.addAttempts()).toBe(4);
		expect(test.polls()).toBeGreaterThan(0);
	});
});
