import { describe, expect, it } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";
import { Decision, InjectionResult } from "../src/constants.js";
import type { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";
import type { Searchee } from "../src/searchee.js";

function buildClient(versionMajor: number, versionMinor: number) {
	const capture: { form?: FormData } = {};
	const qb = new QBittorrent(
		"http://user:pass@localhost:8080",
		"localhost:8080",
		1,
		false,
	);
	qb.versionMajor = versionMajor;
	qb.versionMinor = versionMinor;
	qb.isTorrentInClient = async () => {
		const { resultOf } = await import("../src/Result.js");
		return resultOf(false);
	};
	let calls = 0;
	qb.getTorrentInfo = (async () => {
		calls++;
		return calls === 1
			? {
					hash: "old",
					save_path: "/tmp",
					auto_tmm: false,
					category: "",
					state: "uploading",
				}
			: { hash: "new" };
	}) as unknown as QBittorrent["getTorrentInfo"];
	qb.addTorrent = async (formData) => {
		capture.form = formData;
	};
	(qb as unknown as { getCategoryForNewTorrent: () => Promise<string> })
		.getCategoryForNewTorrent = async () => "";
	(qb as unknown as { getTagsForNewTorrent: () => string })
		.getTagsForNewTorrent = () => "tag";
	(qb as unknown as { getLayoutForNewTorrent: () => string })
		.getLayoutForNewTorrent = () => "Original";
	return { qb, capture };
}

async function injectWith(versionMajor: number, versionMinor: number) {
	setRuntimeConfig({
		...getRuntimeConfig(),
		skipRecheck: true,
		linkCategory: "",
	} as never);
	const { qb, capture } = buildClient(versionMajor, versionMinor);
	const newTorrent = {
		infoHash: "new",
		files: [],
		getFileSystemSafeName: () => "new",
		encode: () => new Uint8Array([1]),
	} as unknown as Metafile;
	const searchee = { infoHash: "old", files: [] } as unknown as Searchee;
	const result = await qb.inject(newTorrent, searchee, Decision.MATCH_SIZE_ONLY, {
		onlyCompleted: false,
	});
	expect(result).toBe(InjectionResult.SUCCESS);
	if (!capture.form) throw new Error("addTorrent was not called");
	return capture.form;
}

describe("qBittorrent inject skip-recheck field", () => {
	it("sends seedMode on 5.3.0 and newer", async () => {
		const form = await injectWith(5, 3);
		expect(form.has("seedMode")).toBe(true);
		expect(form.has("skip_checking")).toBe(false);
		expect(form.get("seedMode")).toBe("true");
	});

	it("keeps skip_checking before 5.3.0", async () => {
		const form = await injectWith(5, 2);
		expect(form.has("skip_checking")).toBe(true);
		expect(form.has("seedMode")).toBe(false);
		expect(form.get("skip_checking")).toBe("true");
	});
});
