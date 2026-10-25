import type { Context } from "hono";
import type { HttpEnv } from "../httpTypes.js";
import { readFile } from "node:fs/promises";
import { getAsset, getAssetKeys, isSea } from "node:sea";
import { extname, isAbsolute, join, relative, sep } from "path";
import { isTruthy } from "../utils.js";
import ErrnoException = NodeJS.ErrnoException;

const SENTINEL_BASE_PATH = "/__CROSS_SEED_BASE_PATH__";
const STATIC_ROOT = join(import.meta.dirname, "..", "..", "dist", "webui");
const INDEX_HTML_PATH = join(STATIC_ROOT, "index.html");
const WEBUI_ASSET_PREFIX = "webui/";
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
const TEXT_EXT = [".html", ".css", ".js", ".mjs", ".json"];

function injectBasePath(
	content: string | Buffer,
	basePath: string,
): string | Buffer {
	if (typeof content === "string") {
		return content.replaceAll(SENTINEL_BASE_PATH, basePath);
	}
	return content;
}

function getContentType(ext: string): string {
	return MIME_TYPES[ext] || "application/octet-stream";
}

function createFileNotFoundError(filePath: string): NodeJS.ErrnoException {
	const error = new Error(
		`ENOENT: no such file or directory, open '${filePath}'`,
	) as NodeJS.ErrnoException;
	error.code = "ENOENT";
	return error;
}

function getWebuiAssetKey(filePath: string): string {
	return `${WEBUI_ASSET_PREFIX}${relative(STATIC_ROOT, filePath)
		.split(sep)
		.join("/")}`;
}

async function readStaticFile(
	filePath: string,
	isText: boolean,
): Promise<string | Buffer> {
	if (!isSea()) {
		return readFile(filePath, isText ? UTF8 : null);
	}

	const assetKey = getWebuiAssetKey(filePath);
	if (!getAssetKeys().includes(assetKey)) {
		throw createFileNotFoundError(filePath);
	}

	const asset = isText ? getAsset(assetKey, "utf8") : getAsset(assetKey);
	return typeof asset === "string" ? asset : Buffer.from(asset);
}

export async function serveFrontend(
	c: Context<HttpEnv>,
	basePath: string,
): Promise<Response> {
	const requestPath = c.req.path;
	const basePathRelativeUrl = requestPath.startsWith(basePath)
		? requestPath.slice(basePath.length)
		: "MALFORMED_REQUEST_URL"; // should never happen because this route is only registered under basePath
	// Hono decodes some URL escapes. Backslashes become path separators on
	// Windows, so reject them before resolving any filesystem or embedded asset.
	if (
		basePathRelativeUrl.includes("\\") ||
		basePathRelativeUrl.includes("\0")
	) {
		return c.text("Not Found", 404);
	}
	const desiredFilePath = join(
		STATIC_ROOT,
		...basePathRelativeUrl.split("/").filter(isTruthy),
	);
	const assetPath = relative(STATIC_ROOT, desiredFilePath);
	if (
		assetPath === ".." ||
		assetPath.startsWith(`..${sep}`) ||
		isAbsolute(assetPath)
	) {
		return c.text("Not Found", 404);
	}
	let fileContents: string | Buffer;
	let fileExtension = extname(desiredFilePath);

	try {
		const isText = TEXT_EXT.includes(fileExtension);
		fileContents = await readStaticFile(desiredFilePath, isText);
	} catch (e) {
		if (
			(e as ErrnoException).code == "ENOENT" ||
			(e as ErrnoException).code == "EISDIR"
		) {
			if (!(c.req.header("accept")?.includes("text/html") ?? false)) {
				return c.text("Not Found", 404);
			}
			fileContents = await readStaticFile(INDEX_HTML_PATH, true);
			fileExtension = ".html";
		} else {
			throw e;
		}
	}

	const content = injectBasePath(fileContents, basePath);
	return new Response(
		typeof content === "string" ? content : new Uint8Array(content),
		{
			headers: { "Content-Type": getContentType(fileExtension) },
		},
	);
}
