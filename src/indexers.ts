import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { humanReadableDate } from "./utils.js";

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
	tvIdCaps: string;
	movieIdCaps: string;
	categories: string;
}

export async function getAllIndexers(): Promise<Indexer[]> {
	return db("indexer").where({ active: true }).select({
		id: "id",
		url: "url",
		apikey: "apikey",
		active: "active",
		status: "status",
		retryAfter: "retry_after",
		searchCap: "search_cap",
		tvSearchCap: "tv_search_cap",
		movieSearchCap: "movie_search_cap",
		tvIdCaps: "tv_id_caps",
		movieIdCaps: "movie_id_caps",
		categories: "cat_caps",
	});
}

export async function getEnabledIndexers(): Promise<Indexer[]> {
	return db("indexer")
		.whereNot({
			search_cap: null,
			tv_search_cap: null,
			movie_search_cap: null,
			tv_id_caps: null,
			movie_id_caps: null,
			cat_caps: null,
		})
		.where({ active: true, search_cap: true })
		.where((i) =>
			i
				.where({ status: null })
				.orWhere({ status: IndexerStatus.OK })
				.orWhere("retry_after", "<", Date.now()),
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
			tvIdCaps: "tv_id_caps",
			movieIdCaps: "movie_id_caps",
			categories: "cat_caps",
		});
}

export async function updateIndexerStatus(
	status: IndexerStatus,
	retryAfter: number,
	indexerIds: number[],
) {
	if (indexerIds.length > 0) {
		logger.verbose({
			label: Label.TORZNAB,
			message: `Snoozing indexers ${indexerIds} with ${status} until ${humanReadableDate(
				retryAfter,
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
	indexerIds: number[],
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
