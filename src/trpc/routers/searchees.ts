import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../index.js";
import { db } from "../../db.js";
import { findAllSearchees, bulkSearchByNames } from "../../pipeline.js";
import { Label } from "../../logger.js";
import { getSearcheeSource } from "../../searchee.js";
import { getAllIndexers, getEnabledIndexers } from "../../indexers.js";

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

			let query = db("searchee");
			if (search) {
				query = query.where("searchee.name", "like", `%${search}%`);
			}

			const [{ count }] = await query
				.clone()
				.count<{ count: string | number }>({ count: "*" });

			const rows = await query
				.clone()
				.leftJoin("timestamp", "searchee.id", "timestamp.searchee_id")
				.select({
					dbId: "searchee.id",
					name: "searchee.name",
				})
				.min({
					firstSearched: "timestamp.first_searched",
				})
				.max({
					lastSearched: "timestamp.last_searched",
				})
				.countDistinct({
					indexerCount: "timestamp.indexer_id",
				})
				.groupBy("searchee.id", "searchee.name")
				.orderBy("lastSearched", "desc")
				.orderBy("firstSearched", "desc")
				.orderBy("name", "asc")
				.limit(limit)
				.offset(offset);

			const [allSearchees, allIndexers, enabledIndexers] =
				await Promise.all([
					findAllSearchees(Label.SEARCH),
					getAllIndexers(),
					getEnabledIndexers(),
				]);

			// TODO: drop the in-memory metadata lookup when searchee rows expose persistent IDs directly via TRPC.
			const searcheeMeta = new Map<
				string,
				(typeof allSearchees)[number]
			>();
			for (const searchee of allSearchees) {
				const keyCandidates = [searchee.title, searchee.name].filter(
					(candidate): candidate is string =>
						typeof candidate === "string" && candidate.length > 0,
				);
				for (const key of keyCandidates) {
					if (!searcheeMeta.has(key)) {
						searcheeMeta.set(key, searchee);
					}
				}
			}

			const items = rows.map((row) => {
				const displayName =
					// @ts-expect-error something funky going on with knex types
					typeof row.name === "string" && row.name.length
						? row.name
						: "(unknown)";
				const meta =
					searcheeMeta.get(displayName) ??
					searcheeMeta.get(displayName.trim());

				const idCandidate =
					(typeof row.dbId === "number"
						? row.dbId
						: row.dbId != null
							? Number(row.dbId)
							: null) ??
					meta?.infoHash ??
					meta?.path ??
					displayName;

				return {
					id:
						typeof idCandidate === "number"
							? idCandidate
							: String(idCandidate),
					name: displayName,
					indexerCount:
						typeof row.indexerCount === "number"
							? row.indexerCount
							: Number(row.indexerCount ?? 0),
					firstSearchedAt:
						row.firstSearched != null
							? new Date(Number(row.firstSearched)).toISOString()
							: null,
					lastSearchedAt:
						row.lastSearched != null
							? new Date(Number(row.lastSearched)).toISOString()
							: null,
					label: meta?.label ?? null,
					source: meta ? getSearcheeSource(meta) : null,
					length: meta?.length ?? null,
					clientHost: meta?.clientHost ?? null,
				};
			});

			return {
				total: Number(count ?? 0),
				pagination: {
					limit,
					offset,
				},
				indexerTotals: {
					configured: allIndexers.length,
					enabled: enabledIndexers.length,
				},
				items,
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
