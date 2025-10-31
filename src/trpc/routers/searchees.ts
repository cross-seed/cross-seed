import { z } from "zod";
import { router, authedProcedure } from "../index.js";
import { db } from "../../db.js";
import { findAllSearchees } from "../../pipeline.js";
import { Label } from "../../logger.js";
import { getSearcheeSource } from "../../searchee.js";
import { getAllIndexers, getEnabledIndexers } from "../../indexers.js";

const DEFAULT_LIMIT = 50;

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

			const baseQuery = db("searchee").modify((qb) => {
				if (!search) return;
				qb.where("searchee.name", "like", `%${search}%`);
			});

			const [{ count }] = await baseQuery
				.clone()
				.count<{ count: string | number }>({ count: "*" });

			const rows = await baseQuery
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
				indexerTotals: {
					configured: allIndexers.length,
					enabled: enabledIndexers.length,
				},
				items,
			};
		}),
});
