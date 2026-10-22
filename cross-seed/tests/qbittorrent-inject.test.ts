import { afterEach, describe, expect, it, vi } from "vitest";
import QBittorrent from "../src/clients/QBittorrent.js";
import { Decision, InjectionResult } from "../src/constants.js";
import type { Metafile } from "../src/parseTorrent.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";
import { resultOf } from "../src/Result.js";
import type { Searchee } from "../src/searchee.js";

afterEach(() => {
	vi.restoreAllMocks();
});

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
	vi.spyOn(qb, "isTorrentInClient").mockResolvedValue(resultOf(false));
	vi.spyOn(qb, "getTorrentInfo").mockResolvedValue({
		hash: "new",
	} as NonNullable<Awaited<ReturnType<QBittorrent["getTorrentInfo"]>>>);
	vi.spyOn(qb, "addTorrent").mockImplementation((formData) => {
		capture.form = formData;
		return Promise.resolve();
	});
	return { qb, capture };
}

async function injectWith(versionMajor: number, versionMinor: number) {
	setRuntimeConfig({
		...getRuntimeConfig(),
		skipRecheck: true,
		linkCategory: "",
	});
	const { qb, capture } = buildClient(versionMajor, versionMinor);
	const newTorrent = {
		infoHash: "new",
		files: [],
		getFileSystemSafeName: () => "new",
		encode: () => new Uint8Array([1]),
	} as unknown as Metafile;
	const searchee = { infoHash: "old", files: [] } as unknown as Searchee;
	const result = await qb.inject(
		newTorrent,
		searchee,
		Decision.MATCH_SIZE_ONLY,
		{
			onlyCompleted: false,
			destinationDir: "/tmp",
		},
	);
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
