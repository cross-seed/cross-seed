import { Action, LinkType, MatchMode } from "./constants.js";
import { logger } from "./logger.js";
import { z } from "zod";
import ms from "ms";
import { sep } from "path";

/**
 * error messages and map returned upon Zod validation failure
 */
const ZodErrorMessages = {
	vercel: "format does not follow vercel's `ms` style ( https://github.com/vercel/ms#examples )",
	emptyString:
		"cannot have an empty string. If you want to unset it, use null or undefined.",
	delay: "delay is in seconds, you can't travel back in time.",
	fuzzySizeThreshold: "fuzzySizeThreshold must be between 0 and 1.",
	injectUrl:
		"You need to specify rtorrentRpcUrl, transmissionRpcUrl, qbittorrentUrl, or delugeRpcUrl when using 'inject'",
	riskyRecheckWarn:
		"It is strongly recommended to not skip rechecking for risky matching mode.",
	windowsPath: `Your path is not formatted properly for Windows. Please use "\\\\" or "/" for directory separators.`,
	qBitLegacyLinking:
		"Using Automatic Torrent Management in qBittorrent without legacyLinking enabled can result in injection path failures.",
	riskyNeedsLinkDir: "You need to set a linkDir for risky matching to work.",
};

/**
 * custom zod error map for logging
 * @param error ZodIssue messaging object
 * @param ctx ZodError map
 * @returns (the custom error for config display)
 */
export const zodErrorMap: z.ZodErrorMap = (error, ctx) => {
	switch (error.code) {
		case z.ZodIssueCode.invalid_union:
			return {
				message: error.unionErrors
					.reduce((acc, error) => {
						// @ts-expect-error avoids type conflict string to never
						error.errors.forEach((x) => acc.push(x.message));
						return acc;
					}, [])
					.join("; "),
			};
	}

	return { message: ctx.defaultError };
};

/**
 * adds an issue in Zod's error mapped formatting
 * @param setting the value of the setting
 * @param errorMessage the error message to append on a newline
 * @param ctx ZodError map
 */
function zodAddIssue(setting: string, errorMessage: string, ctx): void {
	ctx.addIssue({
		code: "custom",
		message: `Setting: "${setting}"\n\t${errorMessage}`,
	});
}

/**
 * helper function for ms time validation
 * @return transformed duration (string -> milliseconds)
 */

function transformDurationString(durationStr: string, ctx) {
	const duration = ms(durationStr);
	if (isNaN(duration)) {
		// adds the error to the Zod Issues
		zodAddIssue(durationStr, ZodErrorMessages.vercel, ctx);
	}
	return duration;
}

/**
 * helper function for directory validation
 * @return path if valid formatting
 */
function checkValidPathFormat(path: string, ctx) {
	if (sep === "\\" && !path.includes("\\") && !path.includes("/")) {
		zodAddIssue(path, ZodErrorMessages.windowsPath, ctx);
	}
	return path;
}

/**
 * an object of the zod schema
 * each are named after what they are intended to validate
 */

export const VALIDATION_SCHEMA = z
	.object({
		delay: z.number().nonnegative({
			message: ZodErrorMessages.delay,
		}),
		torznab: z.array(z.string().url()),
		dataDirs: z
			.array(
				z
					.string()
					.transform((value, ctx) =>
						value && value.length > 0
							? checkValidPathFormat(value, ctx)
							: null
					)
			)

			.nullish(),
		matchMode: z.nativeEnum(MatchMode),
		dataCategory: z.string().nullish(),
		linkDir: z.string().transform(checkValidPathFormat).nullish(),
		linkType: z.nativeEnum(LinkType),
		legacyLinking: z
			.boolean()
			.nullish()
			.transform((value) => (typeof value === "boolean" ? value : false)),
		skipRecheck: z.boolean(),
		maxDataDepth: z.number().gte(1),
		torrentDir: z.string(),
		outputDir: z.string(),
		includeEpisodes: z.boolean(),
		includeSingleEpisodes: z.boolean(),
		includeNonVideos: z.boolean(),
		fuzzySizeThreshold: z.number().positive().lte(1, {
			message: ZodErrorMessages.fuzzySizeThreshold,
		}),
		excludeOlder: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
		excludeRecentSearch: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
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
			.or(z.boolean().transform(() => null))
			.nullish(),
		host: z.string().ip().nullish(),
		rssCadence: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchCadence: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
		snatchTimeout: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchTimeout: z
			.string()
			.min(1, { message: ZodErrorMessages.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchLimit: z.number().nonnegative().nullish(),
		verbose: z.boolean(),
		torrents: z.array(z.string()).optional(),
		blockList: z
			.array(z.string())
			.nullish()
			.transform((value) => (Array.isArray(value) ? value : [])),
	})
	.strict()
	.refine((config) => {
		if (
			config.action === Action.INJECT &&
			config.qbittorrentUrl &&
			!config.legacyLinking &&
			config.linkDir
		) {
			logger.warn(ZodErrorMessages.qBitLegacyLinking);
		}
		return true;
	})
	.refine(
		(config) =>
			!(
				config.action === Action.INJECT &&
				!config.rtorrentRpcUrl &&
				!config.qbittorrentUrl &&
				!config.transmissionRpcUrl &&
				!config.delugeRpcUrl
			),
		ZodErrorMessages.injectUrl
	)
	.refine((config) => {
		if (config.skipRecheck && config.matchMode === MatchMode.RISKY) {
			logger.warn(ZodErrorMessages.riskyRecheckWarn);
		}
		return true;
	})
	.refine(
		(config) => config.matchMode !== MatchMode.RISKY || config.linkDir,
		ZodErrorMessages.riskyNeedsLinkDir
	);
