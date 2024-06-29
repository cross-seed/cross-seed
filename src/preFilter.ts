import ms from "ms";
import { extname, basename, dirname } from "path";
import { statSync } from "fs";
import {
	ARR_DIR_REGEX,
	EP_REGEX,
	SONARR_SUBFOLDERS_REGEX,
	SEASON_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { db } from "./db.js";
import { getEnabledIndexers } from "./indexers.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { indexerDoesSupportMediaType } from "./torznab.js";
import { getMediaType, humanReadableDate, nMsAgo } from "./utils.js";

function logReason(reason: string, searchee: Searchee): void {
	logger.verbose({
		label: Label.PREFILTER,
		message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
	});
}

function isSonarrSeasonFolder(searchee: Searchee): boolean {
	return (
		searchee.files.length > 1 &&
		SONARR_SUBFOLDERS_REGEX.test(basename(searchee.path!))
	);
}

function isSeasonPackEpisode(searchee: Searchee): boolean {
	return (
		!!searchee.path &&
		searchee.files.length === 1 &&
		(SEASON_REGEX.test(basename(dirname(searchee.path))) ||
			SONARR_SUBFOLDERS_REGEX.test(basename(dirname(searchee.path))))
	);
}

export function filterByContent(searchee: Searchee): boolean {
	const {
		includeEpisodes,
		includeNonVideos,
		includeSingleEpisodes,
		blockList,
	} = getRuntimeConfig();

	const blockedNote = findBlockedStringInReleaseMaybe(searchee, blockList);
	if (blockedNote) {
		logReason(`it matched the blocklist - ("${blockedNote}")`, searchee);
		return false;
	}

	const isSeasonPackEp = isSeasonPackEpisode(searchee);

	if (
		!includeEpisodes &&
		!includeSingleEpisodes &&
		!isSeasonPackEp &&
		EP_REGEX.test(searchee.name)
	) {
		logReason("it is a single episode", searchee);
		return false;
	}

	if (!includeEpisodes && isSeasonPackEp) {
		logReason("it is a season pack episode", searchee);
		return false;
	}
	const allFilesAreVideos = searchee.files.every((file) =>
		VIDEO_EXTENSIONS.includes(extname(file.name)),
	);

	if (!includeNonVideos && !allFilesAreVideos) {
		logReason("not all files are videos", searchee);
		return false;
	}

	if (
		searchee.path &&
		statSync(searchee.path).isDirectory() &&
		ARR_DIR_REGEX.test(basename(searchee.path)) &&
		!isSonarrSeasonFolder(searchee)
	) {
		logReason("it is could be an arr movie/series directory", searchee);
		return false;
	}
	return true;
}

export function findBlockedStringInReleaseMaybe(
	searchee: Searchee,
	blockList: string[],
): string | undefined {
	return blockList.find((blockedStr) => {
		return (
			searchee.name.includes(blockedStr) ||
			blockedStr === searchee.infoHash
		);
	});
}

export function filterDupes(searchees: Searchee[]): Searchee[] {
	const duplicateMap = searchees.reduce((acc, cur) => {
		const entry = acc.get(cur.name);
		if (entry === undefined) {
			acc.set(cur.name, cur);
		} else if (cur.infoHash && !entry.infoHash) {
			acc.set(cur.name, cur);
		}
		return acc;
	}, new Map());

	const filtered = Array.from(duplicateMap.values());
	const numDupes = searchees.length - filtered.length;
	if (numDupes > 0) {
		logger.verbose({
			label: Label.PREFILTER,
			message: `${numDupes} duplicates not selected for searching`,
		});
	}
	return filtered;
}

type TimestampDataSql = {
	first_searched_any: number;
	last_searched_all: number;
};

export async function filterTimestamps(searchee: Searchee): Promise<boolean> {
	const { excludeOlder, excludeRecentSearch } = getRuntimeConfig();
	const enabledIndexers = await getEnabledIndexers();
	const mediaType = getMediaType(searchee);
	const timestampDataSql: TimestampDataSql = (await db("searchee")
		// @ts-expect-error crossJoin supports string
		.crossJoin("indexer")
		.leftOuterJoin("timestamp", {
			"timestamp.indexer_id": "indexer.id",
			"timestamp.searchee_id": "searchee.id",
		})
		.where("searchee.name", searchee.name)
		.whereIn(
			"indexer.id",
			enabledIndexers
				.filter((indexer) =>
					indexerDoesSupportMediaType(
						mediaType,
						JSON.parse(indexer.categories),
					),
				)
				.map((indexer) => indexer.id),
		)
		.min({
			first_searched_any: db.raw(
				"coalesce(timestamp.first_searched, 9223372036854775807)",
			),
		})
		.min({
			last_searched_all: db.raw("coalesce(timestamp.last_searched, 0)"),
		})
		.first()) as TimestampDataSql;

	const { first_searched_any, last_searched_all } = timestampDataSql;
	function logReason(reason) {
		logger.verbose({
			label: Label.PREFILTER,
			message: `Torrent ${searchee.name} was not selected for searching because ${reason}`,
		});
	}

	if (
		typeof excludeOlder === "number" &&
		first_searched_any &&
		first_searched_any < nMsAgo(excludeOlder)
	) {
		logReason(
			`its first search timestamp ${humanReadableDate(
				first_searched_any,
			)} is older than ${ms(excludeOlder, { long: true })} ago`,
		);
		return false;
	}

	if (
		typeof excludeRecentSearch === "number" &&
		last_searched_all &&
		last_searched_all > nMsAgo(excludeRecentSearch)
	) {
		logReason(
			`its last search timestamp ${humanReadableDate(
				last_searched_all,
			)} is newer than ${ms(excludeRecentSearch, { long: true })} ago`,
		);
		return false;
	}

	return true;
}
