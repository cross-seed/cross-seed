import { uniqBy } from "lodash-es";
import path from "path";
import { EP_REGEX, EXTENSIONS } from "./constants.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { db } from "./db.js";
import { nMinutesAgo } from "./utils.js";

const extensionsWithDots = EXTENSIONS.map((e) => `.${e}`);

export function filterByContent(searchee: Searchee): boolean {
	const { includeEpisodes, searchAll } = getRuntimeConfig();

	if (searchAll) return true;

	function logReason(reason): void {
		logger.verbose({
			label: Label.PREFILTER,
			message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
		});
	}

	if (
		!includeEpisodes &&
		searchee.files.length === 1 &&
		EP_REGEX.test(searchee.files[0].name)
	) {
		logReason("it is a single episode");
		return false;
	}

	const allVideos = searchee.files.every((file) =>
		extensionsWithDots.includes(path.extname(file.name))
	);

	if (!allVideos) {
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
		.where({ name: searchee.name })
		.first();

	if (!timestampDataSql) return true;
	const { first_searched, last_searched } = timestampDataSql;
	function logReason(reason) {
		logger.verbose({
			label: Label.PREFILTER,
			message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
		});
	}

	if (
		excludeOlder &&
		first_searched &&
		first_searched < nMinutesAgo(excludeOlder)
	) {
		logReason(
			`its first search timestamp ${first_searched} is older than ${excludeOlder} minutes ago`
		);
		return false;
	}

	if (
		excludeRecentSearch &&
		last_searched &&
		last_searched > nMinutesAgo(excludeRecentSearch)
	) {
		logReason(
			`its last search timestamp ${last_searched} is newer than ${excludeRecentSearch} minutes ago`
		);
		return false;
	}

	return true;
}
