import { z } from "zod";
import { authedProcedure, router } from "../index.js";
import {
	getLibraryScanStatuses,
	listLibraryItems,
} from "../../libraryInventory.js";

const librarySourceSchema = z.enum(["torrentClient", "torrentFile", "dataDir"]);

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
					sortBy: z
						.enum(["lastSeenAt", "title", "length", "source"])
						.default("lastSeenAt"),
					sortDirection: z.enum(["asc", "desc"]).default("desc"),
				})
				.default({
					includeFiles: false,
					limit: 50,
					offset: 0,
					sortBy: "lastSeenAt",
					sortDirection: "desc",
				}),
		)
		.query(({ input }) => listLibraryItems(input)),

	getScanStatuses: authedProcedure
		.input(libraryScopeSchema.default({}))
		.query(({ input }) => getLibraryScanStatuses(input)),
});
