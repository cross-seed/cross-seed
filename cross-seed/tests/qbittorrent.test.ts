import { describe, expect, it } from "vitest";
import { skipRecheckField } from "../src/clients/qbittorrent-version.js";

describe("qBittorrent skip-recheck form field", () => {
	it("keeps skip_checking for clients older than 5.3.0", () => {
		expect(skipRecheckField(4, 6)).toBe("skip_checking");
		expect(skipRecheckField(5, 2)).toBe("skip_checking");
	});

	it("uses seedMode from qBittorrent 5.3.0 onwards", () => {
		expect(skipRecheckField(5, 3)).toBe("seedMode");
		expect(skipRecheckField(5, 4)).toBe("seedMode");
		expect(skipRecheckField(6, 0)).toBe("seedMode");
	});
});
