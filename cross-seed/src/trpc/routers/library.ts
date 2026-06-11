import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../index.js";
import {
	getLibraryScanStatuses,
	listLibraryItems,
} from "../../libraryInventory.js";
import { bulkSearchByNames } from "../../pipeline.js";

const librarySourceSchema = z.enum(["torrentClient", "torrentFile", "dataDir"]);
const MAX_BULK_SEARCH = 20;

const libraryScopeSchema = z.object({
	source: librarySourceSchema.optional(),
	sourceInstance: z.string().nullable().optional(),
});

export const libraryRouter = router({
	listItems: authedProcedure
		.input(
			libraryScopeSchema
				.extend({
					search: z.string().trim().min(1).max(200).optional(),
					includeFiles: z.boolean().default(false),
					limit: z.number().int().min(1).max(200).default(50),
					offset: z.number().int().min(0).default(0),
					cursor: z.string().nullable().optional(),
					sortBy: z
						.enum(["lastSeenAt", "title", "length", "source"])
						.default("lastSeenAt"),
					sortDirection: z.enum(["asc", "desc"]).default("desc"),
				})
				.default({
					includeFiles: false,
					limit: 50,
					offset: 0,
					cursor: null,
					sortBy: "lastSeenAt",
					sortDirection: "desc",
				}),
		)
		.query(({ input }) => listLibraryItems(input)),

	getScanStatuses: authedProcedure
		.input(libraryScopeSchema.default({}))
		.query(({ input }) => getLibraryScanStatuses(input)),

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
