import { authedProcedure, router } from "../index.js";
import { db } from "../../db.js";

export const statsRouter = router({
	getOverview: authedProcedure.query(async () => {
		const [
			searcheeResult,
			indexerResult,
			activeIndexerResult,
			decisionsByType,
			recentMatches,
		] = await Promise.all([
			db("searchee").count({ count: "*" }).first(),
			db("indexer").count({ count: "*" }).first(),
			db("indexer").where("active", true).count({ count: "*" }).first(),
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

		// All persisted decisions represent downloaded torrents
		const totalDecisions = decisionsByType.reduce(
			(sum, row) => sum + Number(row.count || 0),
			0,
		);
		const snatchAttempts = totalDecisions;

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
			totalIndexers: indexerResult?.count || 0,
			activeIndexers: activeIndexerResult?.count || 0,
			recentMatches: recentMatches?.count || 0,
			matchRate: parseFloat(matchRate),
			matchesPerSnatch: parseFloat(matchesPerSnatch),
			decisionBreakdown: decisionsByType,
		};
	}),

	getIndexerStats: authedProcedure.query(async () => {
		const indexers = await db("indexer")
			.select("id", "name", "active", "status")
			.orderBy("name");

		return indexers.map((indexer) => ({
			id: indexer.id,
			name: indexer.name || `Indexer ${indexer.id}`,
			active: indexer.active,
			status: indexer.status || "unknown",
		}));
	}),
});
