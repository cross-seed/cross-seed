import { Knex } from "knex";
import type { Decision as DecisionType } from "./constants.js";
import { IndexerStatus } from "./indexers.js";

declare module "knex/types/tables.js" {
	interface Decision {
		decision: DecisionType;
		first_seen: number;
		fuzzy_size_factor: number;
		guid: string;
		id: number;
		info_hash: string;
		last_seen: number;
		searchee_id: number;
	}

	interface Indexer {
		id: number;
		url: string;
		apikey: string;
		name: string | null;
		trackers: string | null;
		enabled: boolean;
		status: IndexerStatus | null;
		retry_after: number | null;
		search_cap: boolean | null;
		tv_search_cap: boolean | null;
		movie_search_cap: boolean | null;
		music_search_cap: boolean | null;
		audio_search_cap: boolean | null;
		book_search_cap: boolean | null;
		tv_id_caps: string | null;
		movie_id_caps: string | null;
		cat_caps: string | null;
		limits_caps: string | null;
	}

	interface JobLog {
		id: number;
		name: string;
		last_run: number;
	}

	interface LibraryItem {
		id: number;
		source: string;
		source_instance: string | null;
		source_key: string;
		client_host: string | null;
		info_hash: string | null;
		path: string | null;
		name: string;
		title: string;
		files: string;
		length: number;
		save_path: string | null;
		category: string | null;
		tags: string | null;
		trackers: string | null;
		content_fingerprint: string | null;
		first_seen_at: number;
		last_seen_at: number;
		last_indexed_at: number;
		missing_since: number | null;
		last_seen_scan_id: number | null;
		updated_at: number;
	}

	type LibraryItemInsert = Omit<
		LibraryItem,
		| "id"
		| "source_instance"
		| "client_host"
		| "info_hash"
		| "path"
		| "save_path"
		| "category"
		| "tags"
		| "trackers"
		| "content_fingerprint"
		| "missing_since"
		| "last_seen_scan_id"
	> &
		Partial<
			Pick<
				LibraryItem,
				| "source_instance"
				| "client_host"
				| "info_hash"
				| "path"
				| "save_path"
				| "category"
				| "tags"
				| "trackers"
				| "content_fingerprint"
				| "missing_since"
				| "last_seen_scan_id"
			>
		>;

	interface LibraryScan {
		id: number;
		source: string;
		source_instance: string | null;
		status: string;
		started_at: number;
		finished_at: number | null;
		error: string | null;
		items_seen: number;
		items_upserted: number;
		items_removed: number;
	}

	type LibraryScanInsert = Omit<
		LibraryScan,
		| "id"
		| "source_instance"
		| "finished_at"
		| "error"
		| "items_seen"
		| "items_upserted"
		| "items_removed"
	> &
		Partial<
			Pick<
				LibraryScan,
				| "source_instance"
				| "finished_at"
				| "error"
				| "items_seen"
				| "items_upserted"
				| "items_removed"
			>
		>;

	interface Rss {
		indexer_id: number;
		last_seen_guid: string;
	}

	interface Searchee {
		id: number;
		name: string;
		first_searched: null;
		last_searched: null;
	}

	interface Settings {
		id: number;
		apikey: string | null;
		settings_json: string | null;
	}

	interface Timestamp {
		indexer_id: number;
		searchee_id: number;
		first_searched: number;
		last_searched: number;
	}

	interface Torrent {
		id: number;
		name: string;
		info_hash: string;
		file_path: string;
	}

	interface Tables {
		decision: Knex.CompositeTableType<Decision, Omit<Decision, "id">>;
		indexer: Knex.CompositeTableType<Indexer, Omit<Indexer, "id">>;
		job_log: Knex.CompositeTableType<JobLog, Omit<JobLog, "id">>;
		library_item: Knex.CompositeTableType<
			LibraryItem,
			LibraryItemInsert,
			Partial<Omit<LibraryItem, "id" | "source_key" | "first_seen_at">>
		>;
		library_scan: Knex.CompositeTableType<
			LibraryScan,
			LibraryScanInsert,
			Partial<Omit<LibraryScan, "id" | "started_at">>
		>;
		rss: Knex.CompositeTableType<
			Rss,
			Rss,
			Partial<Omit<Rss, "indexer_id">>
		>;
		searchee: Knex.CompositeTableType<
			Searchee,
			Omit<Searchee, "id" | "first_searched" | "last_searched">
		>;
		settings: Knex.CompositeTableType<Settings, Omit<Settings, "id">>;
		timestamp: Knex.CompositeTableType<
			Timestamp,
			Timestamp,
			Partial<Omit<Timestamp, "indexer_id" | "searchee_id">>
		>;
		torrent: Knex.CompositeTableType<Torrent, Omit<Torrent, "id">>;
	}
}
