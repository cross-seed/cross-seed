import { uniqBy } from "lodash-es";
import ms from "ms";
import path from "path";
import { EP_REGEX, EXTENSIONS } from "./constants.js";
import { db } from "./db.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { humanReadable, nMsAgo } from "./utils.js";

const extensionsWithDots = EXTENSIONS.map((e) => `.${e}`);

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
		extensionsWithDots.includes(path.extname(file.name))
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
		.join("timestamp", "searchee.id", "timestamp.searchee_id")
		.join("indexer", "timestamp.indexer_id", "indexer.id")
		.where({ name: searchee.name })
		.max({ first_searched_all: "timestamp.first_searched" })
		.min({ last_searched_all: "timestamp.last_searched" })
		.first();

	if (!timestampDataSql) return true;
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
