import { FastifyInstance, FastifyPluginAsync } from "fastify";
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
			const statusResponse = {
				version: PROGRAM_VERSION,
				appName: "cross-seed",
			};

			return await reply.code(200).send(statusResponse);
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error getting indexer status: ${error.message}`,
			});
			return reply.code(500).send({
				code: "INTERNAL_ERROR",
				message: "Failed to get status",
			});
		}
	});

	/**
	 * List all indexers
	 */
	app.get<{
		Querystring: { apikey?: string; includeInactive?: boolean };
	}>("/api/indexer/v1", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		try {
			const { includeInactive = false } = request.query;
			const indexers = await listAllIndexers({ includeInactive });
			return await reply.code(200).send(indexers);
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error listing indexers: ${error.message}`,
			});
			return reply.code(500).send({
				code: "INTERNAL_ERROR",
				message: "Failed to list indexers",
			});
		}
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

		try {
			const validatedData = indexerCreateSchema.parse(request.body);
			const indexer = await createIndexer(validatedData);
			return await reply.code(201).send(indexer);
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error creating/updating indexer: ${error.message}`,
			});

			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: error.message,
			});
		}
	});

	/**
	 * Update existing indexer
	 */
	app.put<{
		Params: { id: string };
		Body: {
			name?: string | null;
			url?: string;
			apikey?: string;
			active?: boolean;
		};
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/:id", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		try {
			const id = parseInt(request.params.id, 10);
			if (isNaN(id)) {
				return await reply.code(400).send({
					code: "VALIDATION_ERROR",
					message: "Invalid indexer ID",
				});
			}

			const validatedData = indexerUpdateSchema.parse({
				id,
				...request.body,
			});

			const result = await updateIndexer(validatedData);
			if (result.isErr()) {
				return await reply.code(404).send({
					code: "INDEXER_NOT_FOUND",
					message: `Indexer with ID ${id} not found`,
				});
			}

			return await reply.code(200).send(result.unwrap());
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error updating indexer: ${error.message}`,
			});

			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: error.message,
			});
		}
	});

	/**
	 * Deactivate indexer (soft delete)
	 */
	app.delete<{
		Params: { id: string };
		Querystring: { apikey?: string };
	}>("/api/indexer/v1/:id", async (request, reply) => {
		if (!(await authorize(request, reply))) return;

		const id = parseInt(request.params.id, 10);
		if (isNaN(id)) {
			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: "Invalid indexer ID",
			});
		}

		try {
			const result = await deactivateIndexer(id);
			if (result.isErr()) {
				return await reply.code(404).send({
					code: "INDEXER_NOT_FOUND",
					message: `Indexer with ID ${id} not found`,
				});
			}

			return await reply.code(200).send(result.unwrap());
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error deactivating indexer: ${error.message}`,
			});
			return reply.code(500).send({
				code: "INTERNAL_ERROR",
				message: "Failed to deactivate indexer",
			});
		}
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

		try {
			let result;

			if (request.body.id) {
				// Test existing indexer
				result = await testExistingIndexer(request.body.id);
			} else {
				// Test new indexer configuration
				const validatedData = indexerTestSchema.parse(request.body);
				result = await testNewIndexer(validatedData);
			}

			if (result.isErr()) {
				const errorCode = result.unwrapErr();
				const errorMessages = {
					INDEXER_NOT_FOUND: "Indexer not found",
					CONNECTION_FAILED: "Connection failed",
					TIMEOUT: "Connection timed out",
					AUTH_FAILED: "Authentication failed - check API key",
					RATE_LIMITED: "Rate limited by indexer",
				};

				logger.warn({
					label: Label.SERVER,
					message: `Connection test failed: ${errorMessages[errorCode]}`,
				});

				return await reply.code(200).send({
					ok: false,
					code: errorCode,
					message: errorMessages[errorCode],
				});
			}

			const success = result.unwrap();
			return await reply.code(200).send({
				ok: true,
				message: success.message,
			});
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Error testing indexer: ${error.message}`,
			});

			return reply.code(400).send({
				code: "VALIDATION_ERROR",
				message: error.message,
			});
		}
	});
};
