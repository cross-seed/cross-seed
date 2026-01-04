import { authedProcedure, router } from "../index.js";
import { db } from "../../db.js";
import { estimateSearchString } from "../../torznab.js";
import { mapAsync } from "../../utils.js";

export const statsRouter = router({
	getOverview: authedProcedure.query(async () => {
		const [
			searcheeResult,
			searcheeNames,
			totalIndexerResult,
			healthyIndexerResult,
			timestampResult,
			decisionsByType,
			recentMatches,
			matchAggregates,
		] = await Promise.all([
			db("searchee").count({ count: "*" }).first(),
			db("searchee").select("name"),
			db("indexer").count({ count: "*" }).first(),
			db("indexer")
				.where({ enabled: true, search_cap: true })
				.where((qb) =>
					qb
						.whereNull("status")
						.orWhere("status", "OK")
						.orWhere("retry_after", "<", Date.now()),
				)
				.count({ count: "*" })
				.first(),
			db("timestamp").count({ count: "*" }).first(),
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
			db("decision")
				.whereNotNull("info_hash")
				.select({
					snatchCount: db.raw("COUNT(DISTINCT info_hash)"),
					matchCount: db.raw(
						"COUNT(DISTINCT CASE WHEN decision IN ('MATCH','MATCH_SIZE_ONLY','MATCH_PARTIAL') THEN info_hash END)",
					),
					matchCountWithInfoHash: db.raw(
						"COUNT(DISTINCT CASE WHEN decision IN ('MATCH','MATCH_SIZE_ONLY','MATCH_PARTIAL','SAME_INFO_HASH','INFO_HASH_ALREADY_EXISTS') THEN info_hash END)",
					),
				})
				.first(),
		]);

		const snatchCount = Number(matchAggregates?.snatchCount ?? 0);
		const matchCount = Number(matchAggregates?.matchCount ?? 0);
		const matchCountWithInfoHash = Number(
			matchAggregates?.matchCountWithInfoHash ?? 0,
		);
		const totalMatches = matchCount;
		const searcheeNameList = searcheeNames
			.map((row) => row.name)
			.filter(
				(name): name is string =>
					typeof name === "string" && name.length > 0,
			);
		const queryCount = new Set(
			await mapAsync(searcheeNameList, estimateSearchString),
		).size;

		const totalSearchees = Number(searcheeResult?.count || 0);
		const matchRate =
			totalSearchees > 0
				? (totalMatches / totalSearchees).toFixed(2)
				: "0";
		const matchesPerSnatch =
			snatchCount > 0
				? (matchCountWithInfoHash / snatchCount).toFixed(3)
				: "0";
		const matchesPerQuery =
			queryCount > 0 ? (matchCount / queryCount).toFixed(3) : "0";
		const queryIndexerCount = Number(timestampResult?.count || 0);
		const matchesPerQueryIndexer =
			queryIndexerCount > 0
				? (matchCount / queryIndexerCount).toFixed(3)
				: "0";
		const wastedSnatchCount = Math.max(
			snatchCount - matchCountWithInfoHash,
			0,
		);
		const wastedSnatchRate =
			snatchCount > 0
				? (wastedSnatchCount / snatchCount).toFixed(3)
				: "0";
		const totalIndexers = Number(totalIndexerResult?.count || 0);
		const healthyIndexers = Number(healthyIndexerResult?.count || 0);
		const unhealthyIndexers = Math.max(totalIndexers - healthyIndexers, 0);
		const allIndexersHealthy = unhealthyIndexers === 0;

		return {
			totalSearchees,
			totalMatches,
			totalIndexers,
			healthyIndexers,
			recentMatches: recentMatches?.count || 0,
			matchRate: parseFloat(matchRate),
			matchesPerSnatch: parseFloat(matchesPerSnatch),
			matchesPerQuery: parseFloat(matchesPerQuery),
			matchesPerQueryIndexer: parseFloat(matchesPerQueryIndexer),
			snatchCount,
			queryCount,
			queryIndexerCount,
			wastedSnatchCount,
			wastedSnatchRate: parseFloat(wastedSnatchRate),
			unhealthyIndexers,
			allIndexersHealthy,
			decisionBreakdown: decisionsByType,
		};
	}),

	getIndexerStats: authedProcedure.query(async () => {
		const indexers = await db("indexer")
			.select("id", "name", "enabled", "status")
			.orderBy("name");

		return indexers.map((indexer) => ({
			id: indexer.id,
			name: indexer.name || `Indexer ${indexer.id}`,
			enabled: indexer.enabled,
			status: indexer.status || "unknown",
		}));
	}),
});
