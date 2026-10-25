import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";
import { resumeSleepTime } from "../src/clients/TorrentClient.js";
import { Decision } from "../src/constants.js";
import type { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";

vi.mock("../src/logger.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/logger.js")>();
	return {
		...actual,
		logger: {
			debug: vi.fn(),
			verbose: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	};
});

type TorrentInfo = NonNullable<
	Awaited<ReturnType<QBittorrent["getTorrentInfo"]>>
>;

const meta = {
	infoHash: "0123456789abcdef0123456789abcdef01234567",
} as Metafile;

function torrentInfo(state: TorrentInfo["state"], amountLeft = 0): TorrentInfo {
	return { state, name: "fixture", amount_left: amountLeft } as TorrentInfo;
}

function client(): QBittorrent {
	const qb = new QBittorrent(
		"http://localhost:8080",
		"localhost:8080",
		0,
		false,
	);
	qb.versionMajor = 5;
	return qb;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("qBittorrent isTorrentChecking", () => {
	it.each(["checkingResumeData", "checkingDL", "checkingUP"] as const)(
		"recognizes %s as a check in progress",
		async (state) => {
			const qb = client();
			vi.spyOn(qb, "getTorrentInfo").mockResolvedValue(
				torrentInfo(state),
			);
			const result = await qb.isTorrentChecking(meta.infoHash);
			if (result.isErr()) throw new Error(result.unwrapErr());
			expect(result.unwrap()).toBe(true);
		},
	);

	it("does not treat a stopped torrent as checking", async () => {
		const qb = client();
		vi.spyOn(qb, "getTorrentInfo").mockResolvedValue(
			torrentInfo("stoppedUP"),
		);
		const result = await qb.isTorrentChecking(meta.infoHash);
		if (result.isErr()) throw new Error(result.unwrapErr());
		expect(result.unwrap()).toBe(false);
	});

	it("preserves NOT_FOUND when the torrent is absent", async () => {
		const qb = client();
		vi.spyOn(qb, "getTorrentInfo").mockResolvedValue(undefined);
		const result = await qb.isTorrentChecking(meta.infoHash);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.unwrapErr()).toBe("NOT_FOUND");
	});
});

describe("qBittorrent resumeInjection", () => {
	let originalConfig: ReturnType<typeof getRuntimeConfig>;

	beforeEach(() => {
		originalConfig = getRuntimeConfig();
		setRuntimeConfig({
			...originalConfig,
			autoResumeMaxDownload: 0,
			ignoreNonRelevantFilesToResume: false,
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		setRuntimeConfig(originalConfig);
	});

	it.each([0, 1024])(
		"waits for checkingResumeData and rechecking before evaluating %i remaining bytes",
		async (remaining) => {
			const qb = client();
			const poll = vi
				.spyOn(qb, "getTorrentInfo")
				.mockResolvedValueOnce(torrentInfo("checkingResumeData"))
				.mockResolvedValueOnce(torrentInfo("checkingDL"))
				.mockResolvedValue(
					torrentInfo(
						remaining ? "stoppedDL" : "stoppedUP",
						remaining,
					),
				);
			const fetchMock = vi.fn().mockResolvedValue(new Response("Ok."));
			vi.stubGlobal("fetch", fetchMock);

			const done = qb.resumeInjection(meta, Decision.MATCH, {
				checkOnce: false,
			});
			await vi.advanceTimersByTimeAsync(resumeSleepTime * 2);
			expect(poll).toHaveBeenCalledTimes(2);
			expect(fetchMock).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(resumeSleepTime);
			await done;
			expect(poll).toHaveBeenCalledTimes(3);
			if (remaining) {
				expect(fetchMock).not.toHaveBeenCalled();
			} else {
				expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
					"http://localhost:8080/api/v2/torrents/start",
					expect.objectContaining({
						method: "POST",
						body: `hashes=${meta.infoHash}`,
					}),
				);
			}
		},
	);

	it("keeps checkOnce limited to one poll while checking resume data", async () => {
		const qb = client();
		const poll = vi
			.spyOn(qb, "getTorrentInfo")
			.mockResolvedValue(torrentInfo("checkingResumeData"));
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const done = qb.resumeInjection(meta, Decision.MATCH, {
			checkOnce: true,
		});
		await vi.advanceTimersByTimeAsync(resumeSleepTime * 2);
		await done;
		expect(poll).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
