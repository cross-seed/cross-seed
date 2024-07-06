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
import { Searchee, SearcheeWithLabel } from "./searchee.js";
import { indexerDoesSupportMediaType } from "./torznab.js";
import {
	getLogString,
	getMediaType,
	humanReadableDate,
	nMsAgo,
} from "./utils.js";
import chalk from "chalk";

function logReason(reason: string, searchee: Searchee): void {
	logger.verbose({
		label: Label.PREFILTER,
		message: `${getLogString(searchee, chalk.reset)} was not selected for searching because ${reason}`,
	});
}

export function filterByContent(
	searchee: SearcheeWithLabel,
	includeEpisodes?: boolean,
): boolean {
	const {
		fuzzySizeThreshold,
		includeNonVideos,
		includeSingleEpisodes,
		blockList,
	} = getRuntimeConfig();

	const blockedNote = findBlockedStringInReleaseMaybe(searchee, blockList);
	if (blockedNote) {
		logReason(`it matched the blocklist - ("${blockedNote}")`, searchee);
		return false;
	}

	if (
		(!includeEpisodes || !includeSingleEpisodes) &&
		searchee.path &&
		searchee.files.length === 1 &&
		(SEASON_REGEX.test(basename(dirname(searchee.path))) ||
			SONARR_SUBFOLDERS_REGEX.test(basename(dirname(searchee.path))))
	) {
		logReason("it is a season pack episode", searchee);
		return false;
	}

	if (
		!includeSingleEpisodes &&
		![Label.ANNOUNCE, Label.RSS].includes(searchee.label) &&
		EP_REGEX.test(searchee.name)
	) {
		logReason("it is a single episode", searchee);
		return false;
	}

	const nonVideoSizeRatio =
		searchee.files.reduce((acc, cur) => {
			if (!VIDEO_EXTENSIONS.includes(extname(cur.name))) {
				return acc + cur.length;
			}
			return acc;
		}, 0) / searchee.length;

	if (!includeNonVideos && nonVideoSizeRatio > fuzzySizeThreshold) {
		logReason(
			`nonVideoSizeRatio ${nonVideoSizeRatio} > ${fuzzySizeThreshold} fuzzySizeThreshold`,
			searchee,
		);
		return false;
	}

	if (
		searchee.path &&
		statSync(searchee.path).isDirectory() &&
		ARR_DIR_REGEX.test(basename(searchee.path)) &&
		!(
			searchee.files.length > 1 &&
			SONARR_SUBFOLDERS_REGEX.test(basename(searchee.path))
		)
	) {
		logReason("it looks like an arr movie/series directory", searchee);
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

/**
 * Filters duplicates from searchees that should be for different candidates,
 * e.g. all searchees created by cross-seed.
 * @param searchees - An array of searchees to filter duplicates from.
 * @returns An array of searchees with duplicates removed, preferring infoHash.
 */
export function filterDupesByName<T extends Searchee>(searchees: T[]): T[] {
	const duplicateMap = searchees.reduce((acc, cur) => {
		const entry = acc.get(cur.name);
		if (entry === undefined) {
			acc.set(cur.name, cur);
			return acc;
		}
		if (cur.files.length > entry.files.length) {
			acc.set(cur.name, cur);
			return acc;
		}
		if (cur.files.length < entry.files.length) {
			return acc;
		}
		if (cur.infoHash && !entry.infoHash) {
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

/**
 * Filters duplicates from searchees that are for the same candidates,
 * e.g. searchees for the same media but different resolutions.
 * @param searchees - An array of searchees for a specific media.
 * @returns An array of searchees that are unique from a matching perspective.
 */
export function filterDupesFromSimilar<T extends Searchee>(
	searchees: T[],
): T[] {
	const filteredSearchees: T[] = [];
	for (const searchee of searchees) {
		const isDupe = filteredSearchees.some((s) => {
			if (searchee.length !== s.length) return false;
			if (searchee.files.length !== s.files.length) return false;
			const potentialFiles = s.files.map((f) => f.length);
			return searchee.files.every((file) => {
				const index = potentialFiles.indexOf(file.length);
				if (index === -1) return false;
				potentialFiles.splice(index, 1);
				return true;
			});
		});
		if (!isDupe) {
			filteredSearchees.push(searchee);
		}
	}
	return filteredSearchees;
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

	if (
		typeof excludeOlder === "number" &&
		first_searched_any &&
		first_searched_any < nMsAgo(excludeOlder)
	) {
		logReason(
			`its first search timestamp ${humanReadableDate(
				first_searched_any,
			)} is older than ${ms(excludeOlder, { long: true })} ago`,
			searchee,
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
			searchee,
		);
		return false;
	}

	return true;
}
