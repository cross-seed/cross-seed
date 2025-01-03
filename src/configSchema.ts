import { readdirSync } from "fs";
import ms from "ms";
import { isAbsolute, relative, resolve } from "path";
import { ErrorMapCtx, RefinementCtx, z, ZodIssueOptionalMessage } from "zod";
import {
	Action,
	BlocklistType,
	LinkType,
	MatchMode,
	NEWLINE_INDENT,
	parseBlocklistEntry,
} from "./constants.js";
import { logger } from "./logger.js";
import { formatAsList } from "./utils.js";

/**
 * error messages and map returned upon Zod validation failure
 */
const ZodErrorMessages = {
	blocklistType: `Blocklist item does not start with a valid prefix. Must be of ${formatAsList(Object.values(BlocklistType), { sort: false, style: "narrow", type: "unit" })}`,
	blocklistEmptyValue: `Blocklist item must have a value after the colon.`,
	blocklistRegex: `Blocklist regex is not a valid regex.`,
	blocklistFolder: `Blocklist folder must not contain path separators`,
	blocklistTracker: `Blocklist tracker is not a valid URL host. If URL is https://user:pass@tracker.example.com:8080/announce/key, you must use "tracker:tracker.example.com:8080"`,
	blocklistHash: `Blocklist hash must be 40 characters and alphanumeric`,
	blocklistSize: `Blocklist size must be an integer for the number of bytes. You can only have one sizeBelow, one sizeAbove, and sizeBelow <= sizeAbove.`,
	blocklistNeedsClient: `Blocklist ${BlocklistType.CATEGORY}:, ${BlocklistType.TAG}:, and ${BlocklistType.TRACKER}: requires torrentDir and a torrent client to connect to.`,
	blocklistNeedsDataDirs: `Blocklist ${BlocklistType.FOLDER}: and ${BlocklistType.FOLDER_REGEX}: only applies to searchees from dataDirs.`,
	vercel: "format does not follow vercel's `ms` style ( https://github.com/vercel/ms#examples )",
	emptyString:
		"cannot have an empty string. If you want to unset it, use null or undefined.",
	delayNegative: "delay is in seconds, you can't travel back in time.",
	delayUnsupported: `delay must be 30 seconds to 1 hour.${NEWLINE_INDENT}To even out search loads please see the following documentation:${NEWLINE_INDENT}(https://www.cross-seed.org/docs/basics/options#delay)`,
	rssCadenceUnsupported: "rssCadence must be 10-120 minutes",
	searchCadenceUnsupported: "searchCadence must be at least 1 day.",
	searchCadenceExcludeRecent:
		"excludeRecentSearch must be at least 3x searchCadence.",
	excludeRecentOlder:
		"excludeOlder and excludeRecentSearch must be defined for searching. excludeOlder must be 2-5x excludeRecentSearch.",
	injectNeedsInjectMode: "`cross-seed inject` requires the 'inject' action.",
	autoResumeMaxDownloadUnsupported:
		"autoResumeMaxDownload must be an integer of bytes between between 0 and 52428800 (50 MiB).",
	numberMustBeRatio:
		"fuzzySizeThreshold and seasonFromEpisodes must be between 0 and 1.",
	fuzzySizeThresholdMax:
		"fuzzySizeThreshold cannot be greater than 0.1 when using searchCadence or rssCadence.",
	seasonFromEpisodesMin:
		"seasonFromEpisodes cannot be less than 0.5 when using searchCadence or rssCadence",
	injectUrl:
		"You need to specify rtorrentRpcUrl, transmissionRpcUrl, qbittorrentUrl, or delugeRpcUrl when using 'inject'",
	qBitAutoTMM:
		"If using Automatic Torrent Management in qBittorrent, please read: https://www.cross-seed.org/docs/v6-migration#new-folder-structure-for-links",
	includeSingleEpisodes:
		"includeSingleEpisodes is not recommended when using announce, please read: https://www.cross-seed.org/docs/v6-migration#updated-includesingleepisodes-behavior",
	invalidOutputDir:
		"outputDir should only contain .torrent files, cross-seed will populate and manage (https://www.cross-seed.org/docs/basics/options#outputdir)",
	needsInputDir:
		"You need to set at least one of torrentDir (recommended) or dataDirs for search/rss/announce matching to work.",
	matchModeNeedsLinkDirs:
		"When using action 'inject', you need to set linkDirs (and have your data accessible) for risky and partial matchMode.",
	ensembleNeedsClient:
		"seasonFromEpisodes requires a torrent client to connect to when using torrentDir.",
	ensembleNeedsLinkDirs:
		"When using action 'inject', you need to set linkDirs (and have your data accessible) for seasonFromEpisodes. Set seasonFromEpisodes to null to disable.",
	ensembleNeedsPartial:
		"seasonFromEpisodes requires matchMode partial if enabled and value is below 1.",
	linkDirsInOtherDirs:
		"You cannot have your linkDirs inside of your torrentDir/dataDirs/outputDir. Please adjust your paths to correct this.",
	dataDirsInOtherDirs:
		"You cannot have your dataDirs inside of your torrentDir/linkDirs/outputDir. Please adjust your paths to correct this.",
	torrentDirInOtherDirs:
		"You cannot have your torrentDir inside of your dataDirs/linkDirs/outputDir. Please adjust your paths to correct this.",
	outputDirInOtherDirs:
		"You cannot have your outputDir inside of your torrentDir/dataDirs/linkDirs. Please adjust your paths to correct this.",
	relativePaths:
		"Absolute paths for torrentDir, linkDirs, dataDirs, and outputDir are recommended.",
};

/**
 * custom zod error map for logging
 * @param error ZodIssue messaging object
 * @param ctx ZodError map
 * @returns (the custom error for config display)
 */
export function customizeErrorMessage(
	error: ZodIssueOptionalMessage,
	ctx: ErrorMapCtx,
): { message: string } {
	switch (error.code) {
		case z.ZodIssueCode.invalid_union:
			return {
				message: error.unionErrors
					.reduce<string[]>((acc, error) => {
						error.errors.forEach((x) => acc.push(x.message));
						return acc;
					}, [])
					.join("; "),
			};
	}

	return { message: ctx.defaultError };
}

/**
 * adds an issue in Zod's error mapped formatting
 * @param setting the value of the setting
 * @param errorMessage the error message to append on a newline
 * @param ctx ZodError map
 */
function addZodIssue(
	setting: string,
	errorMessage: string,
	ctx: RefinementCtx,
): void {
	ctx.addIssue({
		code: "custom",
		message: `Setting: "${setting}"\n\t${errorMessage}`,
	});
}

/**
 * helper function for ms time validation
 * @param durationStr the duration string to validate
 * @param ctx ZodError map
 * @return transformed duration (string -> milliseconds)
 */
function transformDurationString(durationStr: string, ctx: RefinementCtx) {
	const duration = ms(durationStr);
	if (isNaN(duration)) {
		// adds the error to the Zod Issues
		addZodIssue(durationStr, ZodErrorMessages.vercel, ctx);
	}
	return duration;
}

/**
 * helper function for verifying blocklist types
 * @param blockList the blocklist to validate
 * @param ctx ZodError map
 * @return blocklist (string array)
 */
function transformBlocklist(blockList: string[], ctx: RefinementCtx) {
	if (!Array.isArray(blockList)) {
		return [];
	}
	const sizeTest = (value: string, existing: number) => {
		if (!existing) {
			const match = value.match(/^\d+$/);
			if (match) return parseInt(match[0]);
		}
		addZodIssue(value, ZodErrorMessages.blocklistSize, ctx);
		return existing;
	};
	let sizeBelow = 0;
	let sizeAbove = 0;
	for (const [index, blockRaw] of blockList.entries()) {
		if (!blockRaw.trim().length) {
			addZodIssue(blockRaw, ZodErrorMessages.blocklistType, ctx);
			continue;
		}
		const { blocklistType, blocklistValue } = parseBlocklistEntry(blockRaw);
		switch (blocklistType) {
			case BlocklistType.NAME:
				if (blocklistValue.length === 0) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistEmptyValue,
						ctx,
					);
				}
				break;
			case BlocklistType.FOLDER:
				if (blocklistValue.length === 0) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistEmptyValue,
						ctx,
					);
				}
				if (/[/\\]/.test(blocklistValue)) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistFolder,
						ctx,
					);
				}
				break;
			case BlocklistType.NAME_REGEX:
			case BlocklistType.FOLDER_REGEX:
				if (blocklistValue.length === 0) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistEmptyValue,
						ctx,
					);
				}
				try {
					new RegExp(blocklistValue);
				} catch (e) {
					addZodIssue(blockRaw, ZodErrorMessages.blocklistRegex, ctx);
				}
				break;
			case BlocklistType.CATEGORY:
				if (blocklistValue.length === 0) {
					logger.info(
						`Blocklisting all torrents without a category due to empty ${blockRaw}`,
					);
				}
				break;
			case BlocklistType.TAG:
				if (blocklistValue.length === 0) {
					logger.info(
						`Blocklisting all torrents without a tag due to empty ${blockRaw}`,
					);
				}
				break;
			case BlocklistType.TRACKER:
				if (blocklistValue.length === 0) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistEmptyValue,
						ctx,
					);
				}
				if (/[/@]|^[^.]*$/.test(blocklistValue)) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistTracker,
						ctx,
					);
				}
				break;
			case BlocklistType.INFOHASH:
				if (!/^[a-z0-9]{40}$/i.test(blocklistValue)) {
					addZodIssue(blockRaw, ZodErrorMessages.blocklistHash, ctx);
				}
				blockList[index] =
					`${blocklistType}:${blocklistValue.toLowerCase()}`;
				break;
			case BlocklistType.SIZE_BELOW: {
				sizeBelow = sizeTest(blocklistValue, sizeBelow);
				break;
			}
			case BlocklistType.SIZE_ABOVE: {
				sizeAbove = sizeTest(blocklistValue, sizeAbove);
				break;
			}
			case BlocklistType.LEGACY:
				if (blocklistValue.length === 0) {
					addZodIssue(
						blockRaw,
						ZodErrorMessages.blocklistEmptyValue,
						ctx,
					);
				}
				logger.error(
					`Legacy style blocklist is deprecated, specify a specific type followed by a colon (e.g infoHash:) for ${blockRaw}`,
				);
				break;
			default:
				addZodIssue(blockRaw, ZodErrorMessages.blocklistType, ctx);
		}
	}
	if (sizeBelow && sizeAbove && sizeBelow > sizeAbove) {
		addZodIssue(
			"sizeBelow > sizeAbove",
			ZodErrorMessages.blocklistSize,
			ctx,
		);
	}
	return blockList;
}

/**
 * check a potential child path being inside a array of parent paths
 * @param childDir path of the potential child (e.g outputDir)
 * @param parentDirs array of parentDir paths (e.g dataDirs)
 * @returns true if `childDir` is inside any `parentDirs` at any nesting level, false otherwise.
 */
function isChildPath(childDir: string, parentDirs: string[]): boolean {
	return parentDirs.some((parentDir) => {
		const resolvedParent = resolve(parentDir);
		const resolvedChild = resolve(childDir);
		const relativePath = relative(resolvedParent, resolvedChild);
		// if the path does not start with '..' and is not absolute
		return !(relativePath.startsWith("..") || isAbsolute(relativePath));
	});
}

/**
 * an object of the zod schema
 * each are named after what they are intended to validate
 */

export const VALIDATION_SCHEMA = z
	.object({
		delay: z
			.number()
			.nonnegative(ZodErrorMessages.delayNegative)
			.gte(process.env.DEV ? 0 : 30, ZodErrorMessages.delayUnsupported)
			.lte(3600, ZodErrorMessages.delayUnsupported),
		torznab: z.array(z.string().url()),
		dataDirs: z.array(z.string()).nullish(),
		matchMode: z.nativeEnum(MatchMode),
		skipRecheck: z.boolean().optional().default(true),
		autoResumeMaxDownload: z
			.number()
			.int()
			.gte(0, ZodErrorMessages.autoResumeMaxDownloadUnsupported)
			.lte(52428800, ZodErrorMessages.autoResumeMaxDownloadUnsupported),
		linkCategory: z.string().nullish(),
		linkDir: z.string().nullish(),
		linkDirs: z.array(z.string()).optional().default([]),
		linkType: z.nativeEnum(LinkType),
		flatLinking: z
			.boolean()
			.nullish()
			.transform((v) => (typeof v === "boolean" ? v : false)),
		maxDataDepth: z.number().gte(1),
		torrentDir: z.string().nullable(),
		outputDir: z.string().refine((dir) => {
			if (readdirSync(dir).some((f) => !f.endsWith(".torrent"))) {
				logger.warn(ZodErrorMessages.invalidOutputDir);
			}
			return true;
		}),
		injectDir: z.string().optional(),
		includeSingleEpisodes: z.boolean(),
		includeNonVideos: z.boolean(),
		fuzzySizeThreshold: z
			.number()
			.positive()
			.lte(1, ZodErrorMessages.numberMustBeRatio),
		seasonFromEpisodes: z
			.number()
			.positive()
			.lte(1, ZodErrorMessages.numberMustBeRatio)
			.nullish(),
		excludeOlder: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish()
			.or(
				z
					.boolean()
					.refine((value) => value !== true, {
						message: "Expected string, received boolean (true)",
					})
					.transform(() => null),
			),

		excludeRecentSearch: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish()
			.or(
				z
					.boolean()
					.refine((value) => value !== true, {
						message: "Expected string, received boolean (true)",
					})
					.transform(() => null),
			),

		action: z.nativeEnum(Action),
		qbittorrentUrl: z.string().url().nullish(),
		rtorrentRpcUrl: z.string().url().nullish(),
		transmissionRpcUrl: z.string().url().nullish(),
		delugeRpcUrl: z.string().url().nullish(),
		duplicateCategories: z.boolean(),
		notificationWebhookUrl: z.string().url().nullish(),
		port: z
			.number()
			.positive()
			.lte(65535)
			.or(z.literal(false).transform(() => null))
			.nullish(),
		host: z.string().ip().nullish(),
		rssCadence: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish()
			.refine(
				(cadence) =>
					process.env.DEV ||
					!cadence ||
					(cadence >= ms("10 minutes") && cadence <= ms("2 hours")),
				ZodErrorMessages.rssCadenceUnsupported,
			),
		searchCadence: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish()
			.refine(
				(cadence) =>
					process.env.DEV || !cadence || cadence >= ms("1 day"),
				ZodErrorMessages.searchCadenceUnsupported,
			),
		snatchTimeout: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish(),
		searchTimeout: z
			.string()
			.min(1, ZodErrorMessages.emptyString)
			.transform(transformDurationString)
			.nullish(),
		searchLimit: z.number().nonnegative().nullish(),
		verbose: z.boolean(),
		torrents: z.array(z.string()).optional(),
		blockList: z.array(z.string()).nullish().transform(transformBlocklist),
		apiKey: z.string().min(24).nullish(),
		radarr: z
			.array(z.string().url())
			.nullish()
			.transform((v) => v ?? []),
		sonarr: z
			.array(z.string().url())
			.nullish()
			.transform((v) => v ?? []),
	})
	.strict()
	.refine((config) => {
		if (config.linkDir && config.linkDirs.length) return false;
		if (config.linkDir) {
			logger.warn("linkDir is deprecated, use linkDirs instead.");
			config.linkDirs = [config.linkDir];
		}
		return true;
	}, "You cannot have both linkDir and linkDirs, use linkDirs only.")
	.refine(
		(config) =>
			!config.searchCadence ||
			!config.excludeRecentSearch ||
			3 * config.searchCadence <= config.excludeRecentSearch,
		ZodErrorMessages.searchCadenceExcludeRecent,
	)
	.refine(
		(config) =>
			!config.searchCadence ||
			(config.excludeOlder &&
				config.excludeRecentSearch &&
				config.excludeOlder >= 2 * config.excludeRecentSearch &&
				config.excludeOlder <= 5 * config.excludeRecentSearch),
		ZodErrorMessages.excludeRecentOlder,
	)
	.refine(
		(config) =>
			config.fuzzySizeThreshold <= 0.1 ||
			(!config.searchCadence && !config.rssCadence),
		ZodErrorMessages.fuzzySizeThresholdMax,
	)
	.refine(
		(config) =>
			(!config.searchCadence && !config.rssCadence) ||
			!config.seasonFromEpisodes ||
			config.seasonFromEpisodes >= 0.5,
		ZodErrorMessages.seasonFromEpisodesMin,
	)
	.refine((config) => {
		if (
			config.action === Action.INJECT &&
			config.qbittorrentUrl &&
			!config.flatLinking &&
			config.linkDirs.length
		) {
			logger.warn(ZodErrorMessages.qBitAutoTMM);
		}
		return true;
	})
	.refine((config) => {
		if (config.includeSingleEpisodes && config.rssCadence) {
			logger.warn(ZodErrorMessages.includeSingleEpisodes);
		}
		return true;
	})
	.refine(
		(config) => config.action === Action.INJECT || !config.injectDir,
		ZodErrorMessages.injectNeedsInjectMode,
	)
	.refine(
		(config) =>
			!(
				config.action === Action.INJECT &&
				!config.rtorrentRpcUrl &&
				!config.qbittorrentUrl &&
				!config.transmissionRpcUrl &&
				!config.delugeRpcUrl
			),
		ZodErrorMessages.injectUrl,
	)
	.refine((config) => {
		if (
			config.delugeRpcUrl &&
			config.blockList.some((b) => b.startsWith(`${BlocklistType.TAG}:`))
		) {
			logger.error(
				`${BlocklistType.TAG}: blocklisting is deprecated for Deluge, please use ${BlocklistType.CATEGORY}: instead (all ${BlocklistType.TAG}: blocklist items has being automatically converted to ${BlocklistType.CATEGORY}:).`,
			);
			config.blockList = config.blockList.map((b) => {
				if (b.startsWith(`${BlocklistType.TAG}:`)) {
					return b.replace(BlocklistType.TAG, BlocklistType.CATEGORY);
				}
				return b;
			});
		}
		if (
			(config.transmissionRpcUrl || config.rtorrentRpcUrl) &&
			config.blockList.some((b) =>
				b.startsWith(`${BlocklistType.CATEGORY}:`),
			)
		) {
			logger.error(
				`Your client does not support ${BlocklistType.CATEGORY}: blocklisting, use ${BlocklistType.TAG}: instead for labels.`,
			);
			return false;
		}
		return true;
	})
	.refine((config) => {
		if (
			!config.blockList.some(
				(b) =>
					b.startsWith(`${BlocklistType.CATEGORY}:`) ||
					b.startsWith(`${BlocklistType.TAG}:`) ||
					b.startsWith(`${BlocklistType.TRACKER}:`),
			)
		) {
			return true;
		}
		if (
			!(
				config.torrentDir &&
				(config.qbittorrentUrl ||
					config.delugeRpcUrl ||
					config.transmissionRpcUrl ||
					config.rtorrentRpcUrl)
			)
		) {
			logger.error(ZodErrorMessages.blocklistNeedsClient);
		}
		return true;
	}, ZodErrorMessages.blocklistNeedsClient)
	.refine((config) => {
		if (
			!config.blockList.some(
				(b) =>
					b.startsWith(`${BlocklistType.FOLDER}:`) ||
					b.startsWith(`${BlocklistType.FOLDER_REGEX}:`),
			)
		) {
			return true;
		}
		if (!config.dataDirs?.length) {
			logger.error(ZodErrorMessages.blocklistNeedsDataDirs);
		}
		return true;
	}, ZodErrorMessages.blocklistNeedsDataDirs)
	.refine(
		(config) =>
			config.torrentDir ||
			config.dataDirs?.length ||
			(!config.rssCadence && !config.searchCadence),
		ZodErrorMessages.needsInputDir,
	)
	.refine(
		(config) =>
			config.linkDirs.length ||
			config.matchMode === MatchMode.SAFE ||
			config.action === Action.SAVE,
		ZodErrorMessages.matchModeNeedsLinkDirs,
	)
	.refine(
		(config) =>
			!config.seasonFromEpisodes ||
			!config.torrentDir ||
			config.qbittorrentUrl ||
			config.delugeRpcUrl ||
			config.transmissionRpcUrl ||
			config.rtorrentRpcUrl,
		ZodErrorMessages.ensembleNeedsClient,
	)
	.refine((config) => {
		if (!config.seasonFromEpisodes) return true;
		if (config.action === Action.SAVE) {
			logger.warn(
				"Using action 'save' with seasonFromEpisodes is not recommended as these matches are extremely complicated, you will need to run 'cross-seed inject' to add to client.",
			);
			return true;
		}
		return config.linkDirs.length;
	}, ZodErrorMessages.ensembleNeedsLinkDirs)
	.refine((config) => {
		if (config.seasonFromEpisodes && config.seasonFromEpisodes < 1) {
			return config.matchMode === MatchMode.PARTIAL;
		}
		return true;
	}, ZodErrorMessages.ensembleNeedsPartial)
	.refine((config) => {
		if (!config.dataDirs?.length) return true;
		if (!config.seasonFromEpisodes && !config.includeSingleEpisodes) {
			return true;
		}
		logger.warn(
			`Using seasonFromEpisodes or includeSingleEpisodes with dataDirs requires a specific data structure${config.maxDataDepth < 3 ? " and likely needs a maxDataDepth of 3" : ""}, please read: https://www.cross-seed.org/docs/tutorials/data-based-matching#setting-up-data-based-matching`,
		);
		return true;
	})
	.refine((config) => {
		if (!config.linkDirs.length) return true;
		for (const linkDir of config.linkDirs) {
			if (isChildPath(linkDir, [config.outputDir])) return false;
			if (config.dataDirs && isChildPath(linkDir, config.dataDirs)) {
				return false;
			}
			if (
				config.torrentDir &&
				isChildPath(linkDir, [config.torrentDir])
			) {
				return false;
			}
		}
		return true;
	}, ZodErrorMessages.linkDirsInOtherDirs)
	.refine((config) => {
		if (!config.dataDirs) return true;
		for (const dataDir of config.dataDirs) {
			if (isChildPath(dataDir, [config.outputDir])) return false;
			if (
				config.torrentDir &&
				isChildPath(dataDir, [config.torrentDir])
			) {
				return false;
			}
			if (
				config.linkDirs.length &&
				isChildPath(dataDir, config.linkDirs)
			) {
				return false;
			}
		}
		return true;
	}, ZodErrorMessages.dataDirsInOtherDirs)
	.refine((config) => {
		if (!config.torrentDir) return true;
		if (isChildPath(config.torrentDir, [config.outputDir])) return false;
		if (
			config.dataDirs &&
			isChildPath(config.torrentDir, config.dataDirs)
		) {
			return false;
		}
		if (
			config.linkDirs.length &&
			isChildPath(config.torrentDir, config.linkDirs)
		) {
			return false;
		}
		return true;
	}, ZodErrorMessages.torrentDirInOtherDirs)
	.refine((config) => {
		if (
			config.torrentDir &&
			isChildPath(config.outputDir, [config.torrentDir])
		) {
			return false;
		}
		if (config.dataDirs && isChildPath(config.outputDir, config.dataDirs)) {
			return false;
		}
		if (
			config.linkDirs.length &&
			isChildPath(config.outputDir, config.linkDirs)
		) {
			return false;
		}
		return true;
	}, ZodErrorMessages.outputDirInOtherDirs)
	.refine((config) => {
		if (
			!isAbsolute(config.outputDir) ||
			!config.linkDirs.every(isAbsolute) ||
			(config.torrentDir && !isAbsolute(config.torrentDir)) ||
			(config.dataDirs && !config.dataDirs.every(isAbsolute))
		) {
			logger.warn(ZodErrorMessages.relativePaths);
		}
		return true;
	});
