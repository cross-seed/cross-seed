import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { humanReadable } from "./utils.js";

export enum IndexerStatus {
	/**
	 * equivalent to null
	 */
	OK = "OK",
	RATE_LIMITED = "RATE_LIMITED",
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface Indexer {
	id: number;
	url: string;
	apikey: string;
	/**
	 * Whether the indexer is currently specified in config
	 */
	active: boolean;
	status: IndexerStatus;
	retryAfter: number;
	searchCap: boolean;
	tvSearchCap: boolean;
	movieSearchCap: boolean;
}

export async function getEnabledIndexers() {
	return db("indexer")
		.where({ active: true, search_cap: true, status: null })
		.orWhere({ active: true, search_cap: true, status: IndexerStatus.OK })
		.orWhere((b) =>
			b
				.where({ active: true, search_cap: true })
				.where("retry_after", "<", Date.now())
		)
		.select({
			id: "id",
			url: "url",
			apikey: "apikey",
			active: "active",
			status: "status",
			retryAfter: "retry_after",
			searchCap: "search_cap",
			tvSearchCap: "tv_search_cap",
			movieSearchCap: "movie_search_cap",
		});
}

export async function updateIndexerStatus(
	status: IndexerStatus,
	retryAfter: number,
	indexerIds: number[]
) {
	if (indexerIds.length > 0) {
		logger.verbose({
			label: Label.TORZNAB,
			message: `Snoozing indexers ${indexerIds} with ${status} until ${humanReadable(
				retryAfter
			)}`,
		});

		await db("indexer").whereIn("id", indexerIds).update({
			retry_after: retryAfter,
			status,
		});
	}
}

export async function updateSearchTimestamps(
	name: string,
	indexerIds: number[]
) {
	for (const indexerId of indexerIds) {
		await db.transaction(async (trx) => {
			const now = Date.now();
			const { id: searchee_id } = await trx("searchee")
				.where({ name })
				.select("id")
				.first();

			await trx("timestamp")
				.insert({
					searchee_id,
					indexer_id: indexerId,
					last_searched: now,
					first_searched: now,
				})
				.onConflict(["searchee_id", "indexer_id"])
				.merge(["searchee_id", "indexer_id", "last_searched"]);
		});
	}
}
