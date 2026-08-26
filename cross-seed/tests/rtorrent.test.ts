import { describe, expect, it, vi } from "vitest";

import RTorrent from "../src/clients/RTorrent.js";

// A minimal structural view of the internals this test drives, so it can stub the
// XML-RPC layer and call the (private) query helper without resorting to `any`.
type RTorrentInternals = {
	methodCallP: (method: string, args: unknown[]) => unknown;
	checkOriginalTorrent: (
		infoHash: string,
		options: { onlyCompleted: boolean },
	) => Promise<{ isErr(): boolean; unwrap(): { isStarted: boolean } }>;
};

describe("RTorrent checkOriginalTorrent", () => {
	// Regression test for #1200: rTorrent's d.is_active can report 1 even when the
	// torrent is genuinely stopped (d.state = 0), which made resumeInjection give up
	// on injected torrents and leave them stopped forever. The running/stopped state
	// must be read from d.state, the persistent started/stopped flag.
	it("reads d.state (not d.is_active) to decide whether a torrent is running", async () => {
		const rtorrent = new RTorrent(
			"http://127.0.0.1:8001/RPC2",
			"127.0.0.1",
			1,
			false,
		);
		const internals = rtorrent as unknown as RTorrentInternals;

		let multicallArgs: unknown;
		internals.methodCallP = vi.fn(
			(method: string, args: unknown[]): unknown => {
				if (method === "system.multicall") {
					multicallArgs = args;
					// name, directory, left_bytes, hashing, complete, is_multi_file, state
					// state = "0": the torrent is stopped and should be resumable.
					return [
						["name"],
						["/dir"],
						["0"],
						["0"],
						["1"],
						["0"],
						["0"],
					];
				}
				return [];
			},
		);

		const result = await internals.checkOriginalTorrent("abc123", {
			onlyCompleted: false,
		});

		expect(result.isErr()).toBe(false);
		expect(result.unwrap().isStarted).toBe(false);

		const methods = (multicallArgs as [{ methodName: string }[]])[0].map(
			(call) => call.methodName,
		);
		expect(methods).toContain("d.state");
		expect(methods).not.toContain("d.is_active");
	});
});
