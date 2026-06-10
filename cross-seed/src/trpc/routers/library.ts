import { z } from "zod";
import { authedProcedure, router } from "../index.js";
import {
	getLibraryScanStatuses,
	LibraryItemSource,
	listLibraryItems,
} from "../../libraryInventory.js";

const librarySourceSchema = z.nativeEnum(LibraryItemSource);

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
				})
				.default({
					includeFiles: false,
					limit: 50,
					offset: 0,
				}),
		)
		.query(({ input }) => listLibraryItems(input)),

	getScanStatuses: authedProcedure
		.input(libraryScopeSchema.default({}))
		.query(({ input }) => getLibraryScanStatuses(input)),
});
