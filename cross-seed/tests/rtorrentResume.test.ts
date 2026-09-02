import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import RTorrent from "../src/clients/RTorrent.js";
import { Decision } from "../src/constants.js";
import { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";

type Call = { method: string; args: unknown[] };

/** [name, directory, left_bytes, hashing, complete, is_multi_file, state, is_active] */
function multicallResponse(
	state: "0" | "1",
	isActive: "0" | "1",
	leftBytes = "0",
) {
	return [
		["Some.Release.2024.1080p.WEB-DL"],
		["/data/links/tracker"],
		[leftBytes],
		["0"],
		["1"],
		["0"],
		[state],
		[isActive],
	];
}

function stubClient(client: RTorrent, response: unknown): Call[] {
	const calls: Call[] = [];
	client.client = {
		methodCall(
			method: string,
			args: unknown[],
			callback: (error: unknown, value: unknown) => void,
		) {
			calls.push({ method, args });
			callback(null, method === "system.multicall" ? response : "0");
		},
	} as unknown as RTorrent["client"];
	return calls;
}

function newClient(): RTorrent {
	return new RTorrent(
		"http://localhost:8080/RPC2",
		"localhost:8080",
		0,
		false,
	);
}

const meta = {
	infoHash: "abc123",
	name: "Some.Release.2024.1080p.WEB-DL",
	files: [{ name: "a.mkv", path: "a.mkv", length: 100 }],
	length: 100,
	pieceLength: 16384,
} as unknown as Metafile;

describe("rTorrent checkOriginalTorrent", () => {
	it("reads started state from d.state, not d.is_active", async () => {
		const client = newClient();
		const calls = stubClient(client, multicallResponse("1", "1"));

		const result = await (
			client as unknown as {
				checkOriginalTorrent(
					infoHash: string,
					options: { onlyCompleted: boolean },
				): Promise<{ unwrap(): { isStarted: boolean } }>;
			}
		).checkOriginalTorrent("abc123", { onlyCompleted: false });

		const methods = (calls[0].args[0] as { methodName: string }[]).map(
			(c) => c.methodName,
		);
		expect(methods).toContain("d.state");
		expect(methods).toContain("d.is_active");
		expect(result.unwrap().isStarted).toBe(true);
	});
});

describe("rTorrent resumeInjection", () => {
	beforeEach(() => {
		setRuntimeConfig({
			...getRuntimeConfig(),
			autoResumeMaxDownload: 0,
			ignoreNonRelevantFilesToResume: false,
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function runResume(response: unknown): Promise<Call[]> {
		const client = newClient();
		const calls = stubClient(client, response);
		const done = client.resumeInjection(meta, Decision.MATCH, {
			checkOnce: true,
		});
		await vi.advanceTimersByTimeAsync(20_000);
		await done;
		return calls;
	}

	it("starts a stopped torrent instead of only resuming it", async () => {
		const calls = await runResume(multicallResponse("0", "1"));
		const methods = calls.map((c) => c.method);

		expect(methods).toContain("d.start");
		expect(methods).toContain("d.resume");
		expect(methods.indexOf("d.start")).toBeLessThan(
			methods.indexOf("d.resume"),
		);
	});

	it("leaves a torrent that is already running alone", async () => {
		const calls = await runResume(multicallResponse("1", "1"));
		const methods = calls.map((c) => c.method);

		expect(methods).not.toContain("d.start");
		expect(methods).not.toContain("d.resume");
	});

	// recheckTorrent() pauses before hashing, which leaves d.state at 1 with
	// d.is_active at 0. Gating the bail on state alone would strand every
	// already-in-client torrent that cross-seed rechecks, paused by its own
	// recheck -- see the ALREADY_EXISTS path in action.ts and inject.ts.
	it("resumes a started torrent that cross-seed paused to recheck", async () => {
		const calls = await runResume(multicallResponse("1", "0"));
		const methods = calls.map((c) => c.method);

		expect(methods).toContain("d.resume");
	});
});
