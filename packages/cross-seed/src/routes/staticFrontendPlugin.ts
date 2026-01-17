import { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "path";
import { isTruthy } from "../utils.js";
import ErrnoException = NodeJS.ErrnoException;

const SENTINEL_BASE_PATH = "/__CROSS_SEED_BASE_PATH__";
const require = createRequire(import.meta.url);
const STATIC_ROOT = join(
	dirname(require.resolve("webui/package.json")),
	"dist",
);
const INDEX_HTML_PATH = join(STATIC_ROOT, "index.html");
const UTF8 = { encoding: "utf-8" } as const;
const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

function injectBasePath(
	content: string,
	ext: string,
	basePath: string,
): string {
	if (
		ext === ".html" ||
		ext === ".css" ||
		ext === ".js" ||
		ext === ".mjs" ||
		ext === ".json"
	) {
		return content.replaceAll(SENTINEL_BASE_PATH, basePath);
	}
	return content;
}

function getContentType(ext: string): string {
	return MIME_TYPES[ext] || "application/octet-stream";
}

export async function staticFrontendPlugin(
	app: FastifyInstance,
	{ basePath }: { basePath: string },
) {
	// Custom static file handler that replaces sentinel values
	app.get("*", async (request, reply) => {
		const basePathRelativeUrl = request.url.startsWith(basePath)
			? request.url.slice(basePath.length)
			: "MALFORMED_REQUEST_URL"; // should never happen because this route is only registered under basePath
		const desiredFilePath = join(
			STATIC_ROOT,
			...basePathRelativeUrl.split("/").filter(isTruthy),
		);
		let fileContents: string;
		let fileExtension: string;

		try {
			fileContents = await readFile(desiredFilePath, UTF8);
			fileExtension = extname(desiredFilePath);
		} catch (e) {
			if (
				(e as ErrnoException).code == "ENOENT" ||
				(e as ErrnoException).code == "EISDIR"
			) {
				fileContents = await readFile(INDEX_HTML_PATH, UTF8);
				fileExtension = ".html";
			} else {
				throw e;
			}
		}

		return reply
			.type(getContentType(fileExtension))
			.send(injectBasePath(fileContents, fileExtension, basePath));
	});
}
