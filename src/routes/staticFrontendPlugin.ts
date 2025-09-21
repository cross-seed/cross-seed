import { FastifyInstance } from "fastify";
import { dirname, join, extname } from "path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
console.log(import.meta.url);
const __dirname = dirname(__filename);

const SENTINEL_BASE_PATH = "/__CROSS_SEED_BASE_PATH__";

function applyBasePathReplacement(content: Buffer, basePath: string): Buffer {
	const textContent = content.toString("utf-8");
	const replacedContent = textContent.replaceAll(
		SENTINEL_BASE_PATH,
		basePath,
	);
	return Buffer.from(replacedContent, "utf-8");
}

export async function staticFrontendPlugin(
	app: FastifyInstance,
	{ basePath }: { basePath: string },
) {
	const staticRoot = join(dirname(dirname(__dirname)), "dist", "webui");

	// Custom static file handler that replaces sentinel values
	app.get("*", async (request, reply) => {
		const basePathRelativeUrl = request.url.startsWith(basePath)
			? request.url.slice(basePath.length)
			: "MALFORMED_REQUEST_URL";
		const requestPath =
			basePathRelativeUrl === "/" ? "/index.html" : basePathRelativeUrl;
		const filePath = join(staticRoot, requestPath);

		try {
			let content = await readFile(filePath);
			const ext = extname(filePath);

			// For text-based files, replace sentinel values
			if ([".html", ".css", ".js", ".mjs", ".json"].includes(ext)) {
				content = applyBasePathReplacement(content, basePath);
			}

			// Set appropriate content type
			const mimeTypes: Record<string, string> = {
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

			const contentType = mimeTypes[ext] || "application/octet-stream";
			return await reply.type(contentType).send(content);
		} catch (error) {
			// If file doesn't exist, serve index.html for SPA routing
			if (request.url !== "/" && !request.url.includes(".")) {
				try {
					const indexPath = join(staticRoot, "index.html");
					const indexContent = await readFile(indexPath);
					const processedContent = applyBasePathReplacement(
						indexContent,
						basePath,
					);

					return reply
						.type("text/html")
						.code(200)
						.send(processedContent);
				} catch (indexError) {
					return reply.code(404).send("Index file not found");
				}
			}

			return reply.code(404).send("Not Found");
		}
	});
}
