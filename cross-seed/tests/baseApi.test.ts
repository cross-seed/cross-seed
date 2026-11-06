import { describe, expect, it } from "vitest";
import { ANNOUNCE_SCHEMA } from "../src/routes/baseApi.js";

const announcePayload = {
	name: "Family.Guy.S24E12.MULTI.1080p.WEB.H264-HiggsBoson",
	guid: "https://digitalcore.club/api/v1/torrents/download/2465381/passkey",
	link: "https://digitalcore.club/api/v1/torrents/download/2465381/passkey",
	tracker: "digitalcore",
};

describe("announce API validation", () => {
	it("defaults an omitted guid to the download link", () => {
		const payload: Partial<typeof announcePayload> = { ...announcePayload };
		delete payload.guid;
		expect(ANNOUNCE_SCHEMA.parse(payload)).toEqual(announcePayload);
	});

	it.each([
		"https://tracker.example/torrents/123",
		"tracker.example/torrent/123",
	])("preserves a distinct stable guid %s", (guid) => {
		const payload = { ...announcePayload, guid };
		expect(ANNOUNCE_SCHEMA.parse(payload)).toEqual(payload);
	});

	it.each(["", "   ", null, 123])(
		"rejects invalid supplied guid %j",
		(guid) => {
			expect(
				ANNOUNCE_SCHEMA.safeParse({ ...announcePayload, guid }).success,
			).toBe(false);
		},
	);

	it("still requires a download URL when a guid is supplied", () => {
		const payload: Partial<typeof announcePayload> = { ...announcePayload };
		delete payload.link;
		expect(ANNOUNCE_SCHEMA.safeParse(payload).success).toBe(false);
		expect(
			ANNOUNCE_SCHEMA.safeParse({ ...announcePayload, link: "not a URL" })
				.success,
		).toBe(false);
	});

	it("accepts announces without a cookie", () => {
		expect(ANNOUNCE_SCHEMA.parse(announcePayload)).toEqual(announcePayload);
	});

	it("treats a blank announce cookie as omitted", () => {
		expect(
			ANNOUNCE_SCHEMA.parse({
				...announcePayload,
				cookie: "   ",
			}),
		).toEqual(announcePayload);
	});
});
