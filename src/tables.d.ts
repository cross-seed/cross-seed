import { Knex } from "knex";

declare module "knex/types/tables.js" {
	interface Decision {
		decision: string;
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
		active?: boolean;
		status?: string | null;
		retry_after?: number | null;
		search_cap?: boolean | null;
		movie_search_cap?: boolean | null;
		tv_search_cap?: boolean | null;
		cat_caps?: string | null;
		limits_caps?: string | null;
		movie_id_caps?: string | null;
		tv_id_caps?: string | null;
	}

	interface JobLog {
		id: number;
		name: string;
		last_run: number;
	}

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
		settings_json: string;
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
		rss: Knex.CompositeTableType<
			Rss,
			Rss,
			Partial<Omit<Rss, "indexer_id">>
		>;
		searchee: Knex.CompositeTableType<
			Searchee,
			Omit<Searchee, "id" | "first_searched" | "last_searched">
		>;
		settings: Settings;
		timestamp: Knex.CompositeTableType<
			Timestamp,
			Timestamp,
			Partial<Omit<Timestamp, "indexer_id" | "searchee_id">>
		>;
		torrent: Knex.CompositeTableType<Torrent, Omit<Torrent, "id">>;
	}
}
