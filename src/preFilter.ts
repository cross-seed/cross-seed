import { uniqBy } from "lodash-es";
import ms from "ms";
import { extname } from "path";
import { EP_REGEX, VIDEO_EXTENSIONS } from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { humanReadable, nMsAgo } from "./utils.js";

export function filterByContent(searchee: Searchee): boolean {
	const { includeEpisodes, includeNonVideos } = getRuntimeConfig();

	function logReason(reason): void {
		logger.verbose({
			label: Label.PREFILTER,
			message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
		});
	}

	const isSingleEpisodeTorrent =
		searchee.files.length === 1 && EP_REGEX.test(searchee.files[0].name);

	if (!includeEpisodes && isSingleEpisodeTorrent) {
		logReason("it is a single episode");
		return false;
	}

	const allFilesAreVideos = searchee.files.every((file) =>
		VIDEO_EXTENSIONS.includes(extname(file.name))
	);

	if (!includeNonVideos && !allFilesAreVideos) {
		logReason("not all files are videos");
		return false;
	}

	return true;
}

export function filterDupes(searchees: Searchee[]): Searchee[] {
	const filtered = uniqBy<Searchee>(searchees, "name");
	const numDupes = searchees.length - filtered.length;
	if (numDupes > 0) {
		logger.verbose({
			label: Label.PREFILTER,
			message: `${numDupes} duplicates not selected for searching`,
		});
	}
	return filtered;
}

export async function filterTimestamps(searchee: Searchee): Promise<boolean> {
	const { excludeOlder, excludeRecentSearch } = getRuntimeConfig();
	const timestampDataSql = await db("searchee")
		// @ts-expect-error crossJoin supports string
		.crossJoin("indexer")
		.leftOuterJoin("timestamp", {
			"timestamp.indexer_id": "indexer.id",
			"timestamp.searchee_id": "searchee.id",
		})
		.where({
			name: searchee.name,
			"indexer.active": true,
			"indexer.search_cap": true,
		})
		.max({
			first_searched_all: db.raw(
				"coalesce(timestamp.first_searched, 9223372036854775807)"
			),
		})
		.min({
			last_searched_all: db.raw("coalesce(timestamp.last_searched, 0)"),
		})
		.first();

	const { first_searched_all, last_searched_all } = timestampDataSql;
	function logReason(reason) {
		logger.verbose({
			label: Label.PREFILTER,
			message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
		});
	}

	if (
		typeof excludeOlder === "number" &&
		first_searched_all &&
		first_searched_all < nMsAgo(excludeOlder)
	) {
		logReason(
			`its first search timestamp ${humanReadable(
				first_searched_all
			)} is older than ${ms(excludeOlder, { long: true })} ago`
		);
		return false;
	}

	if (
		typeof excludeRecentSearch === "number" &&
		last_searched_all &&
		last_searched_all > nMsAgo(excludeRecentSearch)
	) {
		logReason(
			`its last search timestamp ${humanReadable(
				last_searched_all
			)} is newer than ${ms(excludeRecentSearch, { long: true })} ago`
		);
		return false;
	}

	return true;
}
