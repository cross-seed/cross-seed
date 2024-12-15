import { readdirSync } from "fs";
import ms from "ms";
import { isAbsolute, relative, resolve } from "path";
import { ErrorMapCtx, RefinementCtx, z, ZodIssueOptionalMessage } from "zod";
import { Action, LinkType, MatchMode, NEWLINE_INDENT } from "./constants.js";
import { logger } from "./logger.js";

/**
 * error messages and map returned upon Zod validation failure
 */
const ZodErrorMessages = {
	vercel: "format does not follow vercel's `ms` style ( https://github.com/vercel/ms#examples )",
	emptyString:
		"cannot have an empty string. If you want to unset it, use null or undefined.",
	delayNegative: "delay is in seconds, you can't travel back in time.",
	delayUnsupported: `delay must be 30 seconds to 1 hour.${NEWLINE_INDENT}To even out search loads please see the following documentation:${NEWLINE_INDENT}(https://www.cross-seed.org/docs/basics/daemon#set-up-periodic-searches)`,
	rssCadenceUnsupported: "rssCadence must be 10-120 minutes",
	searchCadenceUnsupported: "searchCadence must be at least 1 day.",
	searchCadenceExcludeRecent:
		"excludeRecentSearch must be at least 3x searchCadence.",
	excludeRecentOlder:
		"excludeOlder and excludeRecentSearch must be defined for searching. excludeOlder must be 2-5x excludeRecentSearch.",
	fuzzySizeThreshold:
		"fuzzySizeThreshold must be between 0 and 1 with a maximum of 0.1 when using searchCadence or rssCadence",
	injectNeedsInjectMode: "`cross-seed inject` requires the 'inject' action.",
	maxRemainingForResumeMax: "maxRemainingForResume must be between 0 and 50.",
	injectUrl:
		"You need to specify rtorrentRpcUrl, transmissionRpcUrl, qbittorrentUrl, or delugeRpcUrl when using 'inject'",
	qBitAutoTMM:
		"If using Automatic Torrent Management in qBittorrent, please read: https://www.cross-seed.org/docs/v6-migration#qbittorrent",
	includeSingleEpisodes:
		"includeSingleEpisodes is not recommended when using announce, please read: https://www.cross-seed.org/docs/v6-migration#updated-includesingleepisodes-behavior",
	invalidOutputDir:
		"outputDir should only contain .torrent files, cross-seed will populate and manage (https://www.cross-seed.org/docs/basics/options#outputdir)",
	needsTorrentDir:
		"You need to set torrentDir for rss and announce matching to work.",
	needsInject: "You need to use the 'inject' action for partial matching.",
	needsLinkDir:
		"You need to set a linkDir (and have your data accessible) for risky or partial matching to work.",
	linkDirInOtherDirs:
		"You cannot have your linkDir inside of your torrentDir/dataDirs/outputDir. Please adjust your paths to correct this.",
	dataDirsInOtherDirs:
		"You cannot have your dataDirs inside of your torrentDir/linkDir/outputDir. Please adjust your paths to correct this.",
	torrentDirInOtherDirs:
		"You cannot have your torrentDir inside of your dataDirs/linkDir/outputDir. Please adjust your paths to correct this.",
	outputDirInOtherDirs:
		"You cannot have your outputDir inside of your torrentDir/dataDirs/linkDir. Please adjust your paths to correct this.",
	relativePaths:
		"Absolute paths for torrentDir, linkDir, dataDirs, and outputDir are recommended.",
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
 * check a potential child path being inside an array of parent paths
 * @param childDir path of the potential child (e.g. linkDir)
 * @param parentDirs array of parentDir paths (e.g. dataDirs)
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
		maxRemainingForResume: z
			.number()
			.gte(0, ZodErrorMessages.maxRemainingForResumeMax)
			.lte(50, ZodErrorMessages.maxRemainingForResumeMax),
		linkCategory: z.string().nullish(),
		linkDir: z.string().nullish(),
		linkType: z.nativeEnum(LinkType),
		flatLinking: z
			.boolean()
			.nullish()
			.transform((value) => (typeof value === "boolean" ? value : false)),
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
			.lte(1, ZodErrorMessages.fuzzySizeThreshold),
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
		blockList: z
			.array(z.string())
			.nullish()
			.transform((value) => (Array.isArray(value) ? value : [])),
		apiKey: z.string().min(24).nullish(),
		radarr: z
			.array(z.string().url())
			.nullish()
			.transform((value) => value ?? []),
		sonarr: z
			.array(z.string().url())
			.nullish()
			.transform((value) => value ?? []),
	})
	.strict()
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
		ZodErrorMessages.fuzzySizeThreshold,
	)
	.refine((config) => {
		if (
			config.action === Action.INJECT &&
			config.qbittorrentUrl &&
			!config.flatLinking &&
			config.linkDir
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
	.refine(
		(config) =>
			process.env.DEV ||
			config.action === Action.INJECT ||
			config.matchMode !== MatchMode.PARTIAL,
		ZodErrorMessages.needsInject,
	)
	.refine(
		(config) => config.torrentDir || !config.rssCadence,
		ZodErrorMessages.needsTorrentDir,
	)
	.refine(
		(config) => config.linkDir || config.matchMode === MatchMode.SAFE,
		ZodErrorMessages.needsLinkDir,
	)
	.refine((config) => {
		if (!config.linkDir) return true;
		if (isChildPath(config.linkDir, [config.outputDir])) return false;
		if (config.dataDirs && isChildPath(config.linkDir, config.dataDirs)) {
			return false;
		}
		if (
			config.torrentDir &&
			isChildPath(config.linkDir, [config.torrentDir])
		) {
			return false;
		}
		return true;
	}, ZodErrorMessages.linkDirInOtherDirs)
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
			if (config.linkDir && isChildPath(dataDir, [config.linkDir])) {
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
			config.linkDir &&
			isChildPath(config.torrentDir, [config.linkDir])
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
		if (config.linkDir && isChildPath(config.outputDir, [config.linkDir])) {
			return false;
		}
		return true;
	}, ZodErrorMessages.outputDirInOtherDirs)
	.refine((config) => {
		if (
			!isAbsolute(config.outputDir) ||
			(config.torrentDir && !isAbsolute(config.torrentDir)) ||
			(config.linkDir && !isAbsolute(config.linkDir)) ||
			(config.dataDirs && !config.dataDirs.every(isAbsolute))
		) {
			logger.warn(ZodErrorMessages.relativePaths);
		}
		return true;
	});
