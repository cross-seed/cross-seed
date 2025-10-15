import { Decision } from "../../constants.js";
import { authedProcedure, router } from "../index.js";
import { db } from "../../db.js";

export const statsRouter = router({
	getOverview: authedProcedure.query(async () => {
		const [
			searcheeResult,
			totalActiveIndexerResult,
			enabledIndexerResult,
			decisionsByType,
			recentMatches,
		] = await Promise.all([
			db("searchee").count({ count: "*" }).first(),
			db("indexer").where("active", true).count({ count: "*" }).first(),
			db("indexer")
				.where({ active: true, enabled: true })
				.count({ count: "*" })
				.first(),
			db("decision")
				.select("decision")
				.count({ count: "*" })
				.groupBy("decision"),
			db("decision")
				.whereIn("decision", [
					"MATCH",
					"MATCH_SIZE_ONLY",
					"MATCH_PARTIAL",
				])
				.where("last_seen", ">", Date.now() - 24 * 60 * 60 * 1000) // last 24h
				.count({ count: "*" })
				.first(),
		]);

		// Calculate total matches (all match types)
		const totalMatches = decisionsByType
			.filter((row) =>
				["MATCH", "MATCH_SIZE_ONLY", "MATCH_PARTIAL"].includes(
					row.decision,
				),
			)
			.reduce((sum, row) => sum + Number(row.count || 0), 0);

		const postSnatchDecisions = new Set<Decision>([
			Decision.MATCH,
			Decision.MATCH_SIZE_ONLY,
			Decision.MATCH_PARTIAL,
			Decision.SAME_INFO_HASH,
			Decision.INFO_HASH_ALREADY_EXISTS,
			Decision.FILE_TREE_MISMATCH,
			Decision.SIZE_MISMATCH,
			Decision.PARTIAL_SIZE_MISMATCH,
		]);
		const snatchAttempts = decisionsByType
			.filter((row) => postSnatchDecisions.has(row.decision))
			.reduce((sum, row) => sum + Number(row.count || 0), 0);

		const totalSearchees = Number(searcheeResult?.count || 0);
		const matchRate =
			totalSearchees > 0
				? (totalMatches / totalSearchees).toFixed(2)
				: "0";
		const matchesPerSnatch =
			snatchAttempts > 0
				? (totalMatches / snatchAttempts).toFixed(3)
				: "0";

		return {
			totalSearchees,
			totalMatches,
			totalIndexers: Number(totalActiveIndexerResult?.count || 0),
			enabledIndexers: Number(enabledIndexerResult?.count || 0),
			recentMatches: recentMatches?.count || 0,
			matchRate: parseFloat(matchRate),
			matchesPerSnatch: parseFloat(matchesPerSnatch),
			decisionBreakdown: decisionsByType,
		};
	}),

	getIndexerStats: authedProcedure.query(async () => {
		const indexers = await db("indexer")
			.where("active", true)
			.select("id", "name", "active", "enabled", "status")
			.orderBy("name");

		return indexers.map((indexer) => ({
			id: indexer.id,
			name: indexer.name || `Indexer ${indexer.id}`,
			active: indexer.active,
			enabled: indexer.enabled,
			status: indexer.status || "unknown",
		}));
	}),
});
