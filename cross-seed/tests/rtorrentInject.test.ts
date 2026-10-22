import bencode from "bencode";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../src/runtimeConfig.js";
import type { Searchee } from "../src/searchee.js";
import { buildHybridTorrent } from "./support/hybridTorrent.js";

// importing RTorrent.js opens the database, so point CONFIG_DIR at a
// temporary directory first
process.env.CONFIG_DIR = await mkdtemp(
	join(tmpdir(), "cross-seed-rtorrent-tests-"),
);

const { default: RTorrent } = await import("../src/clients/RTorrent.js");
const { Decision, InjectionResult } = await import("../src/constants.js");
const { Metafile } = await import("../src/parseTorrent.js");
const { resultOf } = await import("../src/Result.js");
const { setRuntimeConfig } = await import("../src/runtimeConfig.js");

// the XML-RPC call, which is the only thing that would leave the process
type XmlRpcCall = (method: string, args: unknown[]) => Promise<unknown>;

interface Payload {
	libtorrent_resume: {
		bitfield: number;
		files: { completed: number; priority: number }[];
	};
}

describe("RTorrent.inject with a hybrid torrent", () => {
	it("sends rTorrent the piece layers with the bytes they had in the torrent", async () => {
		// no recheck, so that injecting does not wait for rTorrent to hash
		setRuntimeConfig({ skipRecheck: true } as RuntimeConfig);
		// the binary key in info makes the infohash depend on its exact bytes too
		const hybrid = buildHybridTorrent({ binaryInfoKey: true });
		const meta = Metafile.decode(hybrid.torrent);
		// the file rTorrent would find, which the resume data counts as complete
		const destinationDir = await mkdtemp(
			join(tmpdir(), "cross-seed-rtorrent-data-"),
		);
		await writeFile(
			join(destinationDir, hybrid.name),
			new Uint8Array(Buffer.alloc(hybrid.length)),
		);

		const client = new RTorrent(
			"http://localhost:8000/RPC2",
			"rtorrent",
			0,
			false,
		);
		const call = vi
			.spyOn(
				client as unknown as { methodCallP: XmlRpcCall },
				"methodCallP",
			)
			.mockResolvedValue(undefined);
		vi.spyOn(client, "isTorrentInClient")
			.mockResolvedValueOnce(resultOf(false))
			.mockResolvedValue(resultOf(true));

		const result = await client.inject(
			meta,
			{ name: hybrid.name } as Searchee,
			Decision.MATCH,
			{ onlyCompleted: false, destinationDir },
		);

		expect(result).toBe(InjectionResult.SUCCESS);
		const load = call.mock.calls.find(
			([method]) => method === "load.raw_start",
		);
		const payload = (load?.[1] as unknown[])[1] as Buffer;

		// The one entry of `piece layers`, as bencoded: its 32 byte binary key,
		// then its value. The key alone also appears as the `pieces root` value
		// in info, which was never corrupted, so it would prove nothing.
		const entry = Buffer.concat([
			Buffer.from("32:"),
			hybrid.piecesRoot,
			Buffer.from("64:"),
			hybrid.pieceLayer,
		]);
		expect(hybrid.torrent.includes(entry)).toBe(true);
		expect(payload.includes(entry)).toBe(true);
		// the info dictionary still hashes to what the torrent's bytes hash to
		expect(Metafile.decode(payload).infoHash).toBe(
			createHash("sha1")
				.update(new Uint8Array(hybrid.info))
				.digest("hex"),
		);

		// the resume data: the whole file, two pieces, is on disk
		// the package garbles the binary keys of `piece layers`, which is no matter
		// here: the resume data is plain text keys and integers
		const { libtorrent_resume: resume } = bencode.decode(
			payload,
		) as Payload;
		expect(resume.bitfield).toBe(2);
		expect(resume.files).toHaveLength(1);
		expect(resume.files[0]).toMatchObject({ completed: 2, priority: 1 });
	});
});
