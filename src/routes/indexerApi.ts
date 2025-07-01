import {
	FastifyInstance,
	FastifyPluginAsync,
	FastifyRequest,
	FastifyReply,
} from "fastify";
import { join, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { getAllIndexers } from "../indexers.js";
import { Label, logger } from "../logger.js";
import { checkApiKey } from "../auth.js";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Authorization function for API routes
 */
async function authorize(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	const apiKey =
		(request.headers["x-api-key"] as string) ||
		(request.query as { apikey?: string }).apikey ||
		"";
	const isAuthorized = await checkApiKey(apiKey);
	if (!isAuthorized) {
		const ipAddress =
			(request.headers["x-forwarded-for"] as string)
				?.split(",")
				.shift() || request.socket.remoteAddress;
		logger.error({
			label: Label.SERVER,
			message: `Unauthorized API access attempt to ${request.url} from ${ipAddress}`,
		});
		void reply
			.code(401)
			.send(
				"Specify the API key in an X-Api-Key header or an apikey query param.",
			);
	}
	return isAuthorized;
}

/**
 * Prowlarr Integration API Routes
 * Base path: /api/indexer/v1
 */
export const indexerApiPlugin: FastifyPluginAsync = async (
	app: FastifyInstance,
) => {
	/**
	 * Indexer management status for Prowlarr integration
	 */
	app.get<{
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/status", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		try {
			// Get version from package.json
			const packagePath = join(
				dirname(dirname(__dirname)),
				"package.json",
			);
			const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
			const version = packageJson.version;

			// Get indexer statistics
			const allIndexers = await getAllIndexers({ includeInactive: true });
			const activeIndexers = allIndexers.filter(
				(indexer) => indexer.active,
			);

			const statusResponse = {
				version,
				appName: "cross-seed",
				indexerCount: allIndexers.length,
				activeIndexers: activeIndexers.length,
			};

			return await reply.code(200).send(statusResponse);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error getting indexer status: ${message}`,
			});
			return await reply
				.code(500)
				.send({ error: "Failed to get status" });
		}
	});
};
