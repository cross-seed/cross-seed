import { z } from "zod";
import { router, authedProcedure } from "../index.js";
import {
	indexerCreateSchema,
	indexerUpdateSchema,
	createIndexer,
	updateIndexer,
	deactivateIndexer,
	testExistingIndexer,
	testNewIndexer,
	listAllIndexers,
} from "../../services/indexerService.js";

export const indexersRouter = router({
	// Get all indexers
	getAll: authedProcedure.query(async () => {
		const indexers = await listAllIndexers({ includeInactive: true });
		return indexers.sort((a, b) =>
			(a.name || "").localeCompare(b.name || ""),
		);
	}),

	// Create new indexer
	create: authedProcedure
		.input(indexerCreateSchema.omit({ active: true })) // tRPC version defaults to active=true
		.mutation(async ({ input }) => {
			return createIndexer({ ...input, active: true });
		}),

	// Update indexer
	update: authedProcedure
		.input(indexerUpdateSchema)
		.mutation(async ({ input }) => {
			return updateIndexer(input);
		}),

	// Deactivate indexer (soft delete)
	delete: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			return deactivateIndexer(input.id);
		}),

	// Test existing indexer connection
	testExisting: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			return testExistingIndexer(input.id);
		}),

	// Test new indexer connection before creating
	testNew: authedProcedure
		.input(
			z.object({
				url: z.string().url(),
				apikey: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			return testNewIndexer(input);
		}),
});
