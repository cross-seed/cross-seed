import { z } from "zod";
import { router, authedProcedure } from "../index.js";
import { db } from "../../db.js";
import { Label, logger } from "../../logger.js";
import { sanitizeUrl } from "../../utils.js";
import { assembleUrl } from "../../torznab.js";
import { USER_AGENT } from "../../constants.js";
import ms from "ms";

const indexerCreateSchema = z.object({
	name: z.string().min(1).optional(),
	url: z.string().url(),
	apikey: z.string().min(1),
});

const indexerUpdateSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().min(1).optional().nullable(),
	url: z.string().url().optional(),
	apikey: z.string().min(1).optional(),
	active: z.boolean().optional(),
});

export const indexersRouter = router({
	// Get all indexers
	getAll: authedProcedure.query(async () => {
		const rawIndexers = await db("indexer").select("*").orderBy("name");

		return rawIndexers.map((indexer) => ({
			id: indexer.id,
			name: indexer.name,
			url: indexer.url,
			active: indexer.active,
			status: indexer.status,
			retryAfter: indexer.retry_after,
			searchCap: indexer.search_cap,
			tvSearchCap: indexer.tv_search_cap,
			movieSearchCap: indexer.movie_search_cap,
			musicSearchCap: indexer.music_search_cap,
			audioSearchCap: indexer.audio_search_cap,
			bookSearchCap: indexer.book_search_cap,
		}));
	}),

	// Create new indexer
	create: authedProcedure
		.input(indexerCreateSchema)
		.mutation(async ({ input }) => {
			const sanitizedUrl = sanitizeUrl(input.url);

			// Check if indexer already exists
			const existing = await db("indexer")
				.where({ url: sanitizedUrl })
				.first();

			if (existing) {
				throw new Error(
					`Indexer with URL ${sanitizedUrl} already exists`,
				);
			}

			const [indexer] = await db("indexer")
				.insert({
					name: input.name || null,
					url: sanitizedUrl,
					apikey: input.apikey,
					active: true,
					status: null,
					retry_after: null,
					search_cap: null,
					tv_search_cap: null,
					movie_search_cap: null,
					music_search_cap: null,
					audio_search_cap: null,
					book_search_cap: null,
					tv_id_caps: null,
					movie_id_caps: null,
					cat_caps: null,
					limits_caps: null,
				})
				.returning("*");

			logger.info({
				label: Label.TORZNAB,
				message: `Created new indexer: ${input.name || sanitizedUrl}`,
			});

			return indexer;
		}),

	// Update indexer
	update: authedProcedure
		.input(indexerUpdateSchema)
		.mutation(async ({ input }) => {
			const { id, ...updates } = input;

			// Check if indexer exists
			const existing = await db("indexer").where({ id }).first();

			if (!existing) {
				throw new Error(`Indexer with ID ${id} not found`);
			}

			// Prepare update object
			const updateData: {
				name?: string | null;
				url?: string;
				apikey?: string;
				active?: boolean;
			} = {};
			if (updates.name !== undefined) updateData.name = updates.name;
			if (updates.url !== undefined)
				updateData.url = sanitizeUrl(updates.url);
			if (updates.apikey !== undefined)
				updateData.apikey = updates.apikey;
			if (updates.active !== undefined)
				updateData.active = updates.active;

			const [updatedIndexer] = await db("indexer")
				.where({ id })
				.update(updateData)
				.returning("*");

			logger.info({
				label: Label.TORZNAB,
				message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
			});

			return updatedIndexer;
		}),

	// Delete indexer
	delete: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			const existing = await db("indexer")
				.where({ id: input.id })
				.first();

			if (!existing) {
				throw new Error(`Indexer with ID ${input.id} not found`);
			}

			await db("indexer").where({ id: input.id }).del();

			logger.info({
				label: Label.TORZNAB,
				message: `Deleted indexer: ${existing.name || existing.url}`,
			});

			return { success: true };
		}),

	// Test indexer connection
	test: authedProcedure
		.input(
			z.object({
				id: z.number().int().positive().optional(),
				url: z.string().url().optional(),
				apikey: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			let testUrl: string;
			let testApikey: string;
			let indexerName: string;

			if (input.id) {
				// Test existing indexer
				const indexer = await db("indexer")
					.where({ id: input.id })
					.first();

				if (!indexer) {
					throw new Error(`Indexer with ID ${input.id} not found`);
				}

				testUrl = indexer.url;
				testApikey = indexer.apikey;
				indexerName = indexer.name || indexer.url;
			} else if (input.url && input.apikey) {
				// Test new indexer before creating
				testUrl = sanitizeUrl(input.url);
				testApikey = input.apikey;
				indexerName = testUrl;
			} else {
				throw new Error(
					"Either id or both url and apikey must be provided",
				);
			}

			try {
				const response = await fetch(
					assembleUrl(testUrl, testApikey, { t: "caps" }),
					{
						headers: { "User-Agent": USER_AGENT },
						signal: AbortSignal.timeout(ms("30 seconds")),
					},
				);

				if (!response.ok) {
					if (response.status === 401) {
						throw new Error(
							"Authentication failed - check API key",
						);
					} else if (response.status === 429) {
						throw new Error("Rate limited by indexer");
					} else {
						throw new Error(
							`HTTP ${response.status}: ${response.statusText}`,
						);
					}
				}

				logger.info({
					label: Label.TORZNAB,
					message: `Test connection successful for: ${indexerName}`,
				});

				return {
					success: true,
					message: "Connection successful",
				};
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";

				logger.warn({
					label: Label.TORZNAB,
					message: `Test connection failed for ${indexerName}: ${message}`,
				});

				return {
					success: false,
					message: `Connection failed: ${message}`,
				};
			}
		}),
});
