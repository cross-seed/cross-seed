import { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { Label, logger } from "../logger.js";
import { PROGRAM_VERSION } from "../constants.js";
import { authorize } from "../utils/authUtils.js";
import {
	indexerCreateSchema,
	indexerUpdateSchema,
	indexerTestSchema,
	createIndexer,
	updateIndexer,
	deactivateIndexer,
	listAllIndexers,
	testNewIndexer,
	testExistingIndexer,
} from "../services/indexerService.js";

// Helper function to parse and validate ID from route params
async function parseIdParam(
	idParam: string,
	reply: FastifyReply,
): Promise<number | false> {
	const id = parseInt(idParam, 10);
	if (isNaN(id) || id <= 0) {
		await reply.code(400).send({
			code: "VALIDATION_ERROR",
			message: "Invalid indexer ID",
		});
		return false;
	}
	return id;
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

		const statusResponse = {
			version: PROGRAM_VERSION,
			appName: "cross-seed",
		};

		return reply.code(200).send(statusResponse);
	});

	/**
	 * List all indexers
	 */
	app.get<{
		Querystring: { apikey?: string; includeInactive?: string };
	}>("/api/indexer/v1", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const includeInactive = request.query.includeInactive === "true";
		const indexers = await listAllIndexers({ includeInactive });
		return reply.code(200).send(indexers);
	});

	/**
	 * Create new indexer (upsert)
	 */
	app.post<{
		Body: {
			name?: string;
			url: string;
			apikey: string;
			active?: boolean;
		};
		Querystring: { apikey?: string };
	}>("/api/indexer/v1", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const validation = indexerCreateSchema.safeParse(request.body);
		if (!validation.success) {
			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: validation.error.message,
			});
		}

		const indexer = await createIndexer(validation.data);
		return reply.code(200).send(indexer);
	});

	/**
	 * Update existing indexer
	 */
	app.put<{
		Params: { id: string };
		Body: {
			id: number;
			name?: string | null;
			url?: string;
			apikey?: string;
			active?: boolean;
		};
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/:id", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const id = await parseIdParam(request.params.id, reply);
		if (!id) return;

		// Ensure body ID matches URL ID
		if (request.body.id !== id) {
			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: "ID in request body must match URL parameter",
			});
		}

		const validation = indexerUpdateSchema.safeParse(request.body);
		if (!validation.success) {
			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: validation.error.message,
			});
		}

		const result = await updateIndexer(validation.data);
		if (result.isOk()) {
			return reply.code(200).send(result.unwrap());
		}

		const err = result.unwrapErr();
		return reply.code(404).send(err);
	});

	/**
	 * Deactivate indexer (soft delete)
	 */
	app.delete<{
		Params: { id: string };
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/:id", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const id = await parseIdParam(request.params.id, reply);
		if (!id) return;

		const result = await deactivateIndexer(id);
		if (result.isOk()) {
			return reply.code(200).send(result.unwrap());
		}

		const err = result.unwrapErr();
		return reply.code(404).send(err);
	});

	/**
	 * Test indexer connection
	 */
	app.post<{
		Body: {
			url: string;
			apikey: string;
			id?: number;
		};
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/test", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		let result;

		if (request.body.id) {
			// Test existing indexer
			result = await testExistingIndexer(request.body.id);
		} else {
			// Test new indexer configuration
			const validation = indexerTestSchema.safeParse(request.body);
			if (!validation.success) {
				return reply.code(400).send({
					code: "VALIDATION_ERROR",
					message: validation.error.message,
				});
			}
			result = await testNewIndexer(validation.data);
		}

		if (result.isOk()) {
			const success = result.unwrap();
			return reply.code(200).send({
				ok: true,
				message: success.message,
			});
		}

		const err = result.unwrapErr();
		if (err.code === "INDEXER_NOT_FOUND") {
			return reply.code(404).send(err);
		}

		logger.warn({
			label: Label.SERVER,
			message: `Connection test failed: ${err.message}`,
		});

		return reply.code(200).send({
			ok: false,
			code: err.code,
			message: err.message,
		});
	});
};
