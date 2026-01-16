import { z } from "zod";
import { router, authedProcedure } from "../index.js";
import {
	indexerCreateSchema,
	indexerUpdateSchema,
	createIndexer,
	updateIndexer,
	deleteIndexer,
	testExistingIndexer,
	testNewIndexer,
	listAllIndexers,
	mergeDisabledIndexer,
} from "../../services/indexerService.js";
import { TRPCError } from "@trpc/server";

export const indexersRouter = router({
	// Get all indexers
	getAll: authedProcedure.query(async () => {
		const indexers = await listAllIndexers();
		return indexers.sort((a, b) =>
			(a.name || "").localeCompare(b.name || ""),
		);
	}),

	mergeDisabled: authedProcedure
		.input(
			z.object({
				sourceId: z.number().int().positive(),
				targetId: z.number().int().positive(),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await mergeDisabledIndexer(
				input.sourceId,
				input.targetId,
			);
			if (result.isErr()) {
				const err = result.unwrapErr();
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: err.message,
				});
			}
			return result.unwrap();
		}),

	// Create new indexer
	create: authedProcedure
		.input(indexerCreateSchema)
		.mutation(async ({ input }) => {
			return createIndexer(input);
		}),

	// Update indexer
	update: authedProcedure
		.input(indexerUpdateSchema)
		.mutation(async ({ input }) => {
			const result = await updateIndexer(input);
			if (result.isErr()) {
				throw new Error(`Indexer with ID ${input.id} not found`);
			}
			return result.unwrap();
		}),

	// Delete indexer
	delete: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			const result = await deleteIndexer(input.id);
			if (result.isErr()) {
				throw new Error(`Indexer with ID ${input.id} not found`);
			}
			return result.unwrap();
		}),

	// Test existing indexer connection
	testExisting: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			const result = await testExistingIndexer(input.id);
			if (result.isErr()) {
				const err = result.unwrapErr();
				throw new Error(err.message);
			}
			return result.unwrap();
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
			const result = await testNewIndexer(input);
			if (result.isErr()) {
				const err = result.unwrapErr();
				throw new Error(err.message);
			}
			return result.unwrap();
		}),
});
