import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../index.js";
import { bulkSearchByNames } from "../../pipeline.js";
import { getAllIndexers, getEnabledIndexers } from "../../indexers.js";
import { listLibraryItems } from "../../libraryInventory.js";

const DEFAULT_LIMIT = 50;
const MAX_BULK_SEARCH = 20;

export const searcheesRouter = router({
	list: authedProcedure
		.input(
			z
				.object({
					search: z.string().trim().min(1).max(200).optional(),
					limit: z
						.number()
						.int()
						.min(1)
						.max(200)
						.default(DEFAULT_LIMIT),
					offset: z.number().int().min(0).default(0),
				})
				.default({
					limit: DEFAULT_LIMIT,
					offset: 0,
				}),
		)
		.query(async ({ input }) => {
			const { search, limit, offset } = input;

			const [libraryItems, allIndexers, enabledIndexers] =
				await Promise.all([
					listLibraryItems({ search, limit, offset }),
					getAllIndexers(),
					getEnabledIndexers(),
				]);

			return {
				total: libraryItems.total,
				pagination: {
					limit,
					offset,
				},
				sourceCounts: libraryItems.sourceCounts,
				indexerTotals: {
					configured: allIndexers.length,
					enabled: enabledIndexers.length,
				},
				items: libraryItems.items.map((item) => ({
					id: item.sourceKey,
					name: item.title || item.name,
					indexerCount: 0,
					firstSearchedAt: null,
					lastSearchedAt: null,
					label: null,
					source: item.source,
					length: item.length,
					clientHost: item.clientHost,
				})),
			};
		}),
	bulkSearch: authedProcedure
		.input(
			z.object({
				names: z
					.array(z.string().trim().min(1).max(500))
					.min(1, "Select at least one item")
					.max(
						MAX_BULK_SEARCH,
						`You can only bulk search up to ${MAX_BULK_SEARCH} items at a time`,
					),
				force: z.boolean().optional().default(false),
			}),
		)
		.mutation(async ({ input }) => {
			const uniqueNames = Array.from(
				new Set(
					input.names
						.map((name) => name.trim())
						.filter((name) => name.length > 0),
				),
			);

			if (!uniqueNames.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No valid item names provided for bulk search",
				});
			}

			const configOverride = input.force
				? {
						excludeRecentSearch: 1,
						excludeOlder: Number.MAX_SAFE_INTEGER,
					}
				: undefined;
			const { attempted, totalFound, requested } =
				await bulkSearchByNames(
					uniqueNames,
					configOverride ? { configOverride } : undefined,
				);

			return {
				requested,
				attempted,
				totalFound,
				skipped: Math.max(requested - attempted, 0),
			};
		}),
});
