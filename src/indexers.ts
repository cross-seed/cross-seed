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

export interface DbIndexer {
	id: number;
	name: string | null;
	url: string;
	apikey: string;
	trackers: string | null;
	/**
	 * Whether the indexer is currently specified in config
	 */
	active: boolean;
	status: IndexerStatus;
	retryAfter: number;
	searchCap: boolean;
	tvSearchCap: boolean;
	movieSearchCap: boolean;
	musicSearchCap: boolean;
	audioSearchCap: boolean;
	bookSearchCap: boolean;
	tvIdCaps: string | null;
	movieIdCaps: string | null;
	catCaps: string | null;
	limitsCaps: string | null;
}

export interface IndexerCategories {
	tv: boolean;
	movie: boolean;
	anime: boolean;
	xxx: boolean;
	audio: boolean;
	book: boolean;
	/**
	 * If the indexer has a category not covered by the above.
	 */
	additional: boolean;
}

export interface IndexerLimits {
	default: number;
	max: number;
}

export interface Caps {
	search: boolean;
	tvSearch: boolean;
	movieSearch: boolean;
	musicSearch: boolean;
	audioSearch: boolean;
	bookSearch: boolean;
	movieIdSearch: IdSearchCaps;
	tvIdSearch: IdSearchCaps;
	categories: IndexerCategories;
	limits: IndexerLimits;
}

export interface IdSearchCaps {
	tvdbId?: boolean;
	tmdbId?: boolean;
	imdbId?: boolean;
	tvMazeId?: boolean;
}

export interface Indexer {
	id: number;
	name: string | null;
	url: string;
	apikey: string;
	trackers: string[] | null;
	/**
	 * Whether the indexer is currently specified in config
	 */
	active: boolean;
	status: IndexerStatus;
	retryAfter: number;
	searchCap: boolean;
	tvSearchCap: boolean;
	movieSearchCap: boolean;
	musicSearchCap: boolean;
	audioSearchCap: boolean;
	bookSearchCap: boolean;
	tvIdCaps: IdSearchCaps;
	movieIdCaps: IdSearchCaps;
	categories: IndexerCategories;
	limits: IndexerLimits;
}

const allFields = {
	id: "id",
	url: "url",
	name: "name",
	apikey: "apikey",
	trackers: "trackers",
	active: "active",
	status: "status",
	retryAfter: "retry_after",
	searchCap: "search_cap",
	tvSearchCap: "tv_search_cap",
	movieSearchCap: "movie_search_cap",
	musicSearchCap: "music_search_cap",
	audioSearchCap: "audio_search_cap",
	bookSearchCap: "book_search_cap",
	tvIdCaps: "tv_id_caps",
	movieIdCaps: "movie_id_caps",
	catCaps: "cat_caps",
	limitsCaps: "limits_caps",
} as const;

export const ALL_CAPS: Caps = {
	limits: {
		default: 100,
		max: 100,
	},
	search: true,
	categories: {
		tv: true,
		movie: true,
		anime: true,
		xxx: true,
		audio: true,
		book: true,
		additional: true,
	},
	tvSearch: true,
	movieSearch: true,
	musicSearch: true,
	audioSearch: true,
	bookSearch: true,
	movieIdSearch: {
		tvdbId: true,
		tmdbId: true,
		imdbId: true,
		tvMazeId: true,
	},
	tvIdSearch: {
		tvdbId: true,
		tmdbId: true,
		imdbId: true,
		tvMazeId: true,
	},
};

function deserialize(dbIndexer: DbIndexer): Indexer {
	const { trackers, tvIdCaps, movieIdCaps, catCaps, limitsCaps, ...rest } =
		dbIndexer;
	return {
		...rest,
		trackers: JSON.parse(trackers ?? "null"),
		tvIdCaps: JSON.parse(tvIdCaps ?? "null"),
		movieIdCaps: JSON.parse(movieIdCaps ?? "null"),
		categories: JSON.parse(catCaps ?? "null"),
		limits: JSON.parse(limitsCaps ?? "null"),
	};
}

/**
 * All indexers in the database, regardless of whether they are currently configured or working.
 */
export async function getAllIndexers(): Promise<Indexer[]> {
	return (await db("indexer").select(allFields)).map(deserialize);
}

/**
 * All indexers that users currently have configured regardless of whether they are working.
 */
export async function getActiveIndexers(): Promise<Indexer[]> {
	return (await db("indexer").where({ active: true }).select(allFields)).map(
		deserialize,
	);
}

/**
 * Indexers that are currently working.
 */
export async function getEnabledIndexers(): Promise<Indexer[]> {
	return (
		await db("indexer")
			.whereNot({
				search_cap: null,
				tv_search_cap: null,
				movie_search_cap: null,
				music_search_cap: null,
				audio_search_cap: null,
				book_search_cap: null,
				tv_id_caps: null,
				movie_id_caps: null,
				cat_caps: null,
				limits_caps: null,
			})
			.where({ active: true, search_cap: true })
			.where((i) =>
				i
					.where({ status: null })
					.orWhere({ status: IndexerStatus.OK })
					.orWhere("retry_after", "<", Date.now()),
			)
			.select(allFields)
	).map(deserialize);
}

export async function updateIndexerStatus(
	status: IndexerStatus,
	retryAfter: number,
	indexerIds: number[],
	indexerNames: Set<string>,
) {
	if (indexerIds.length > 0) {
		logger.verbose({
			label: Label.TORZNAB,
			message: `Snoozing indexers [${Array.from(indexerNames).join(", ")}] with ${status} until ${humanReadableDate(
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
			const { id: searchee_id } = (await trx("searchee")
				.where({ name })
				.select("id")
				.first())!;

			await trx("timestamp")
				.insert({
					searchee_id,
					indexer_id: indexerId,
					last_searched: now,
					first_searched: now,
				})
				.onConflict(["searchee_id", "indexer_id"])
				.merge(["last_searched"] as const);
		});
	}
}

export async function updateIndexerCapsById(indexerId: number, caps: Caps) {
	await db("indexer")
		.where({ id: indexerId })
		.update({
			search_cap: caps.search,
			tv_search_cap: caps.tvSearch,
			movie_search_cap: caps.movieSearch,
			music_search_cap: caps.musicSearch,
			audio_search_cap: caps.audioSearch,
			book_search_cap: caps.bookSearch,
			movie_id_caps: JSON.stringify(caps.movieIdSearch),
			tv_id_caps: JSON.stringify(caps.tvIdSearch),
			cat_caps: JSON.stringify(caps.categories),
			limits_caps: JSON.stringify(caps.limits),
		});
}

export async function clearIndexerFailures() {
	await db("indexer").update({
		status: null,
		retry_after: null,
	});
}

export async function getHostToNameMap(): Promise<Map<string, string>> {
	const hostToName = new Map<string, string>();
	for (const indexer of await getAllIndexers()) {
		if (!indexer.name || !indexer.trackers) continue;
		for (const trackerHost of indexer.trackers) {
			if (hostToName.has(trackerHost)) continue;
			hostToName.set(trackerHost, indexer.name);
		}
	}
	return hostToName;
}
