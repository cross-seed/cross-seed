import { uniqBy } from "lodash";
import { Metafile } from "parse-torrent";
import path from "path";
import { EP_REGEX, EXTENSIONS, SEARCHEES } from "./constants";
import db, { Schema } from "./db";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";
import { Searchee } from "./searchee";
import { nMinutesAgo, partial } from "./utils";

const extensionsWithDots = EXTENSIONS.map((e) => `.${e}`);

export function filterByContent(searchee: Searchee): boolean {
	const { includeEpisodes, searchAll } = getRuntimeConfig();

	if (searchAll) return true;

	const logReason = partial(
		logger.verbose,
		"[prefilter]",
		`Torrent ${searchee.name} was not selected for searching because`
	);
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
		logger.verbose(
			"[prefilter]",
			numDupes,
			"duplicates not selected for searching"
		);
	}
	return filtered;
}

export function filterTimestamps(searchee: Searchee): boolean {
	const { excludeOlder, excludeRecentSearch } = getRuntimeConfig();
	const timestampData = db
		.get<typeof SEARCHEES, typeof searchee.name>([SEARCHEES, searchee.name])
		.value();
	if (!timestampData) return true;
	const { firstSearched, lastSearched } = timestampData;
	const logReason = partial(
		logger.verbose,
		"[prefilter]",
		"Torrent",
		searchee.name,
		"was not selected for searching because"
	);

	if (excludeOlder && firstSearched < nMinutesAgo(excludeOlder)) {
		logReason(
			"its first search timestamp",
			firstSearched,
			"is older than",
			excludeOlder,
			"minutes ago"
		);
		return false;
	}

	if (
		excludeRecentSearch &&
		lastSearched > nMinutesAgo(excludeRecentSearch)
	) {
		logReason(
			"its last search timestamp",
			lastSearched,
			"is newer than",
			excludeRecentSearch,
			"minutes ago"
		);
		return false;
	}

	return true;
}
