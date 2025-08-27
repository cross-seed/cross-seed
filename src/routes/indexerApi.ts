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
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error listing indexers: ${message}`,
			});
			return await reply
				.code(500)
				.send({ error: "Failed to list indexers" });
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
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error creating/updating indexer: ${message}`,
			});

			if (message.includes("validation")) {
				return await reply.code(400).send({ error: message });
			}

			return await reply
				.code(500)
				.send({ error: "Failed to create/update indexer" });
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
				return await reply
					.code(400)
					.send({ error: "Invalid indexer ID" });
			}

			const validatedData = indexerUpdateSchema.parse({
				id,
				...request.body,
			});

			const indexer = await updateIndexer(validatedData);
			return await reply.code(200).send(indexer);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error updating indexer: ${message}`,
			});

			if (message.includes("not found")) {
				return await reply.code(404).send({ error: message });
			}

			if (message.includes("validation")) {
				return await reply.code(400).send({ error: message });
			}

			return await reply
				.code(500)
				.send({ error: "Failed to update indexer" });
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

		try {
			const id = parseInt(request.params.id, 10);
			if (isNaN(id)) {
				return await reply
					.code(400)
					.send({ error: "Invalid indexer ID" });
			}

			const result = await deactivateIndexer(id);
			return await reply.code(200).send(result);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error deactivating indexer: ${message}`,
			});

			if (message.includes("not found")) {
				return await reply.code(404).send({ error: message });
			}

			return await reply
				.code(500)
				.send({ error: "Failed to deactivate indexer" });
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

			return await reply.code(200).send(result);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			logger.error({
				label: Label.SERVER,
				message: `Error testing indexer: ${message}`,
			});

			if (message.includes("not found")) {
				return await reply.code(404).send({ error: message });
			}

			if (message.includes("validation")) {
				return await reply.code(400).send({ error: message });
			}

			return await reply
				.code(500)
				.send({ error: "Failed to test indexer" });
		}
	});
};
