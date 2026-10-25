import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:sea", () => ({
	isSea: () => true,
	getAssetKeys: () => [
		"webui/index.html",
		"webui/assets/app.js",
		"webui/icon.png",
	],
	getAsset: (key: string, encoding?: string) => {
		const text =
			key === "webui/index.html"
				? '<html><script src="/__CROSS_SEED_BASE_PATH__/assets/app.js"></script></html>'
				: 'const base = "/__CROSS_SEED_BASE_PATH__";';
		if (encoding) return text;
		return new Uint8Array([137, 80, 78, 71]).buffer;
	},
}));

describe("embedded frontend HTTP routing", () => {
	afterEach(() => {
		delete process.env.CROSS_SEED_DEV_LOGIN;
	});
	it.each(["", "/cross-seed"])(
		"serves HTML, scripts, binary assets, and HEAD under %s",
		async (basePath) => {
			const { createHttpApp } = await import("../src/server.js");
			const app = createHttpApp(basePath);
			const page = await app.request(`${basePath}/library`, {
				headers: { accept: "text/html" },
			});
			expect(page.status).toBe(200);
			expect(page.headers.get("content-type")).toContain("text/html");
			expect(await page.text()).toContain(`${basePath}/assets/app.js`);
			const script = await app.request(`${basePath}/assets/app.js`);
			expect(script.status).toBe(200);
			expect(script.headers.get("content-type")).toBe(
				"application/javascript",
			);
			expect(await script.text()).toContain(`"${basePath}"`);
			const image = await app.request(`${basePath}/icon.png`);
			expect(image.headers.get("content-type")).toBe("image/png");
			expect(new Uint8Array(await image.arrayBuffer())).toEqual(
				new Uint8Array([137, 80, 78, 71]),
			);
			const head = await app.request(`${basePath}/assets/app.js`, {
				method: "HEAD",
			});
			expect(head.status).toBe(200);
			expect(await head.text()).toBe("");
		},
	);
	it("distinguishes missing assets, client-side routes, and base-path redirects", async () => {
		const { createHttpApp } = await import("../src/server.js");
		const app = createHttpApp("/cross-seed");
		const missing = await app.request("/cross-seed/missing.js");
		expect(missing.status).toBe(404);
		expect(await missing.text()).toBe("Not Found");
		const outside = await app.request("/elsewhere");
		expect(outside.status).toBe(302);
		expect(outside.headers.get("location")).toBe("/cross-seed/");
		const prefix = await app.request("/cross-seed-other");
		expect(prefix.status).toBe(302);
		const root = await app.request("/cross-seed", {
			headers: { accept: "text/html" },
		});
		expect(root.status).toBe(200);
		expect(
			(await app.request("/cross-seed/assets/app.js", { method: "POST" }))
				.status,
		).toBe(404);
	});
	it.each([
		"/..%5cpackage.json",
		"/..%5c..%5cconfig.js",
		"/%5c..%5csecrets",
		"/%00",
	])(
		"rejects decoded path separators and NULs before SPA fallback: %s",
		async (path) => {
			const { createHttpApp } = await import("../src/server.js");
			const response = await createHttpApp().request(path, {
				headers: { accept: "text/html" },
			});
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("Not Found");
		},
	);
});
