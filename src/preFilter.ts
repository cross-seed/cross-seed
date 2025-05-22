import { stat } from "fs/promises";
import ms from "ms";
import { basename, dirname } from "path";
import {
	ARR_DIR_REGEX,
	MediaType,
	SEASON_REGEX,
	SONARR_SUBFOLDERS_REGEX,
	VIDEO_DISC_EXTENSIONS,
	BlocklistType,
	parseBlocklistEntry,
	VIDEO_EXTENSIONS,
	TORRENT_TAG,
	TORRENT_CATEGORY_SUFFIX,
} from "./constants.js";
import { db } from "./db.js";
import { getEnabledIndexers } from "./indexers.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";
import {
	getMediaType,
	getSearcheeNewestFileAge,
	Searchee,
	SearcheeWithLabel,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import { indexerDoesSupportMediaType } from "./torznab.js";
import {
	comparing,
	extractInt,
	filesWithExt,
	getLogString,
	hasExt,
	humanReadableDate,
	nMsAgo,
} from "./utils.js";

const MAX_INT = Number.MAX_SAFE_INTEGER;

function logReason(
	reason: string,
	searchee: Searchee,
	mediaType: MediaType,
): void {
	const message = `${getLogString(searchee)} | MediaType: ${mediaType.toUpperCase()} - ${reason}`;
	if (searchee.label === Label.WEBHOOK) {
		logger.info({
			label: Label.WEBHOOK,
			message: `Did not search for ${message}`,
		});
	} else {
		logger.verbose({
			label: Label.PREFILTER,
			message,
		});
	}
}

export function isSingleEpisode(
	searchee: Searchee,
	mediaType: MediaType,
): boolean {
	if (mediaType === MediaType.EPISODE) return true;
	if (mediaType !== MediaType.ANIME) return false;
	return filesWithExt(searchee.files, VIDEO_EXTENSIONS).length === 1;
	// if (m === MediaType.EPISODE) return true;
	// if (!(m === MediaType.ANIME || m === MediaType.VIDEO)) return false;
	// if (searchee.files.length === 1 && m === MediaType.ANIME) return true;
	// if (searchee.files.length > 5) return false; // Probably a pack, allow extra files
	// To check arrs use: return parsedMedia?.episodes?.length === 1, uncomment above
}

function isCrossSeed(searchee: Searchee): boolean {
	const { linkCategory } = getRuntimeConfig();
	if (linkCategory?.length && searchee.category === linkCategory) return true; // qBit, Deluge
	if (searchee.category === TORRENT_TAG) return true; // Deluge
	if (searchee.category?.endsWith(TORRENT_CATEGORY_SUFFIX)) return true; // qBit, Deluge
	if (searchee.tags?.includes(TORRENT_TAG)) return true; // qBit, rTorrent, Transmission
	if (searchee.tags?.some((tag) => tag.endsWith(TORRENT_CATEGORY_SUFFIX))) {
		return true; // qBit
	}
	return false;
}

export async function filterByContent(
	searchee: SearcheeWithLabel,
	options?: {
		configOverride: Partial<RuntimeConfig>;
		allowSeasonPackEpisodes: boolean;
		ignoreCrossSeeds: boolean;
	},
): Promise<boolean> {
	const {
		fuzzySizeThreshold,
		includeNonVideos,
		includeSingleEpisodes,
		blockList,
	} = getRuntimeConfig(options?.configOverride);

	const mediaType = getMediaType(searchee);

	const blockedNote = findBlockedStringInReleaseMaybe(searchee, blockList);
	if (blockedNote) {
		logReason(
			`it matches the blocklist: ${blockedNote}`,
			searchee,
			mediaType,
		);
		return false;
	}

	if (
		(!options?.allowSeasonPackEpisodes || !includeSingleEpisodes) &&
		searchee.path &&
		searchee.files.length === 1 &&
		[Label.SEARCH, Label.WEBHOOK].includes(searchee.label) &&
		(SEASON_REGEX.test(basename(dirname(searchee.path))) ||
			SONARR_SUBFOLDERS_REGEX.test(basename(dirname(searchee.path))))
	) {
		logReason("it is a season pack episode", searchee, mediaType);
		return false;
	}

	if (
		!includeSingleEpisodes &&
		searchee.label !== Label.ANNOUNCE &&
		isSingleEpisode(searchee, mediaType)
	) {
		logReason("it is a single episode", searchee, mediaType);
		return false;
	}

	const nonVideoSizeRatio =
		searchee.files.reduce((acc, cur) => {
			if (
				!hasExt([cur], [...VIDEO_EXTENSIONS, ...VIDEO_DISC_EXTENSIONS])
			) {
				return acc + cur.length;
			}
			return acc;
		}, 0) / searchee.length;

	if (!includeNonVideos && nonVideoSizeRatio > fuzzySizeThreshold) {
		logReason(
			`nonVideoSizeRatio ${nonVideoSizeRatio.toFixed(3)} > ${fuzzySizeThreshold} fuzzySizeThreshold`,
			searchee,
			mediaType,
		);
		return false;
	}

	if (options?.ignoreCrossSeeds && isCrossSeed(searchee)) {
		logReason("it is a cross seed", searchee, mediaType);
		return false;
	}

	if (
		searchee.path &&
		(await stat(searchee.path)).isDirectory() &&
		ARR_DIR_REGEX.test(basename(searchee.path)) &&
		nonVideoSizeRatio < 0.02 &&
		![MediaType.EPISODE, MediaType.SEASON].includes(mediaType) &&
		!(
			searchee.files.length > 1 &&
			SONARR_SUBFOLDERS_REGEX.test(basename(searchee.path))
		)
	) {
		logReason(
			"it looks like an arr movie/series directory",
			searchee,
			mediaType,
		);
		return false;
	}

	if (
		searchee.path &&
		mediaType === MediaType.SEASON &&
		extractInt(searchee.title.match(SEASON_REGEX)!.groups!.season) === 0
	) {
		logReason("it is a Specials folder", searchee, mediaType);
		return false;
	}

	return true;
}

export function findBlockedStringInReleaseMaybe(
	searchee: Searchee,
	blockList: string[],
): string | undefined {
	return blockList.find((blockedStr) => {
		const { blocklistType, blocklistValue } =
			parseBlocklistEntry(blockedStr);
		switch (blocklistType) {
			case BlocklistType.NAME:
				return searchee.title.includes(blocklistValue);
			case BlocklistType.NAME_REGEX:
				return new RegExp(blocklistValue).test(searchee.title);
			case BlocklistType.FOLDER:
				return (
					searchee.path &&
					dirname(searchee.path).includes(blocklistValue)
				);
			case BlocklistType.FOLDER_REGEX:
				return (
					searchee.path &&
					new RegExp(blocklistValue).test(dirname(searchee.path))
				);
			case BlocklistType.CATEGORY:
				return blocklistValue === searchee.category;
			case BlocklistType.TAG:
				if (!searchee.tags) return false; // Data based or snatched metafile
				return blocklistValue.length
					? searchee.tags.includes(blocklistValue)
					: !searchee.tags.length;
			case BlocklistType.TRACKER:
				return searchee.trackers?.some((url) => url === blocklistValue);
			case BlocklistType.INFOHASH:
				return blocklistValue === searchee.infoHash;
			case BlocklistType.SIZE_BELOW:
				return searchee.length < parseInt(blocklistValue);
			case BlocklistType.SIZE_ABOVE:
				return searchee.length > parseInt(blocklistValue);
			case BlocklistType.LEGACY:
				if (searchee.title.includes(blockedStr)) return true;
				if (blocklistValue === searchee.infoHash) return true;
				if (
					searchee.path &&
					dirname(searchee.path).includes(blockedStr)
				) {
					return true;
				}
				return false;
			default:
				throw new Error(`Unknown blocklist type: ${blockedStr}`);
		}
	});
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
	for (const searchee of [...searchees].sort(comparing((s) => !s.infoHash))) {
		const isDupe = filteredSearchees.some((s) => {
			if (searchee.title !== s.title) return false;
			if (searchee.length !== s.length) return false;
			if (searchee.files.length !== s.files.length) return false;
			if (searchee.clientHost !== s.clientHost) return false;
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
	earliest_first_search: number;
	latest_first_search: number;
	earliest_last_search: number;
};

export async function filterTimestamps(
	searchee: Searchee,
	options?: { configOverride: Partial<RuntimeConfig> },
): Promise<boolean> {
	const { excludeOlder, excludeRecentSearch, seasonFromEpisodes } =
		getRuntimeConfig(options?.configOverride);
	const enabledIndexers = await getEnabledIndexers();
	const mediaType = getMediaType(searchee);
	const timestampDataSql: TimestampDataSql = (await db("searchee")
		// @ts-expect-error crossJoin supports string
		.crossJoin("indexer")
		.leftOuterJoin("timestamp", {
			"timestamp.indexer_id": "indexer.id",
			"timestamp.searchee_id": "searchee.id",
		})
		.where("searchee.name", searchee.title)
		.whereIn(
			"indexer.id",
			enabledIndexers
				.filter((indexer) =>
					indexerDoesSupportMediaType(mediaType, indexer),
				)
				.map((indexer) => indexer.id),
		)
		.min({
			earliest_first_search: db.raw(
				`coalesce(timestamp.first_searched, ${MAX_INT})`,
			),
		})
		.max({
			latest_first_search: db.raw(
				`coalesce(timestamp.first_searched, ${MAX_INT})`,
			),
		})
		.min({
			earliest_last_search: db.raw(
				"coalesce(timestamp.last_searched, 0)",
			),
		})
		.first()) as TimestampDataSql;

	const { earliest_first_search, latest_first_search, earliest_last_search } =
		timestampDataSql;
	if (
		seasonFromEpisodes &&
		!searchee.infoHash &&
		!searchee.path &&
		earliest_last_search <
			(await getSearcheeNewestFileAge(
				searchee as SearcheeWithoutInfoHash,
			))
	) {
		return true;
	}

	const skipBefore = excludeOlder
		? nMsAgo(excludeOlder)
		: Number.NEGATIVE_INFINITY;
	// Don't exclude if new indexer was added
	if (latest_first_search !== MAX_INT) {
		if (earliest_first_search && earliest_first_search < skipBefore) {
			logReason(
				`its first search timestamp ${humanReadableDate(
					earliest_first_search,
				)} is older than ${ms(excludeOlder!, { long: true })} ago`,
				searchee,
				mediaType,
			);
			return false;
		}
	}

	const skipAfter = excludeRecentSearch
		? nMsAgo(excludeRecentSearch)
		: Number.POSITIVE_INFINITY;
	if (earliest_last_search && earliest_last_search > skipAfter) {
		logReason(
			`its last search timestamp ${humanReadableDate(
				earliest_last_search,
			)} is newer than ${ms(excludeRecentSearch!, { long: true })} ago`,
			searchee,
			mediaType,
		);
		return false;
	}

	return true;
}
