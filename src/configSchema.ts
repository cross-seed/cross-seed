import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";
import { logger } from "./logger.js";
import ms from "ms";

/**
 * error messages and map returned upon Zod validation failure
 */
enum zodErrorMsg {
	vercel = "format does not follow vercel's `ms` style ( https://github.com/vercel/ms#examples )",
	emptyString = "cannot have an empty string",
	delay = "delay is in seconds, you can't travel back in time.",
	fuzzySizeThreshold = "fuzzySizeThreshold must be between 0 and 1",
	injectUrl = "You need to specify rtorrentRpcUrl, transmissionRpcUrl, qbittorrentUrl, or delugeRpcUrl when using 'inject'",
	dataBased = "Data-Based Matching requires linkType, dataDirs, and linkDir to be defined",
	riskyRecheckWarn = "It is strongly recommended to not skip rechecking for risky matching mode",
}
export const ZOD_ERROR_MAP: z.ZodErrorMap = (error, ctx) => {
	switch (error.code) {
		case z.ZodIssueCode.invalid_union:
			return {
				message: error.unionErrors
					.reduce((acc, error) => {
						error.errors.forEach((x) => acc.push(x.message));
						return acc;
					}, [])
					.join("; "),
			};
	}

	return { message: ctx.defaultError };
};
/**
 * helper functions for validation
 */

function transformDurationString(durationStr: string, ctx) {
	const duration = ms(durationStr);
	if (isNaN(duration)) {
		ctx.addIssue({
			code: "custom",
			message: zodErrorMsg.vercel,
		});
	}
	return duration;
}

/**
 * an object of the zod schema
 * each are named after what they are intended to validate
 */

export const VALIDATION_SCHEMA = z
	.object({
		delay: z
			.number()
			.positive({
				message: zodErrorMsg.delay,
			})
			.default(10),
		torznab: z.array(z.string().url()),
		dataDirs: z.array(z.string()).nullish(),
		matchMode: z.nativeEnum(MatchMode),
		dataCategory: z.string().nullish(),
		linkDir: z.string().nullish(),
		linkType: z.nativeEnum(LinkType),
		skipRecheck: z.boolean(),
		maxDataDepth: z.number().gte(1),
		torrentDir: z.string(),
		outputDir: z.string(),
		includeEpisodes: z.boolean(),
		includeSingleEpisodes: z.boolean(),
		includeNonVideos: z.boolean(),
		fuzzySizeThreshold: z.number().positive().lte(1, {
			message: zodErrorMsg.fuzzySizeThreshold,
		}),
		excludeOlder: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
			.transform(transformDurationString)
			.nullish(),
		excludeRecentSearch: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
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
			.or(z.boolean().transform(() => null)),
		host: z.string().ip().nullish(),
		rssCadence: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchCadence: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
			.transform(transformDurationString)
			.nullish(),
		snatchTimeout: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchTimeout: z
			.string()
			.min(1, { message: zodErrorMsg.emptyString })
			.transform(transformDurationString)
			.nullish(),
		searchLimit: z.number().positive().nullish(),
		apiAuth: z.boolean().default(false),
		verbose: z.boolean().default(false),
		torrents: z.array(z.string()).optional(),
	})
	.strict()
	.refine(
		(config) =>
			config.action !== Action.INJECT ||
			config.rtorrentRpcUrl ||
			config.qbittorrentUrl ||
			config.transmissionRpcUrl ||
			config.delugeRpcUrl,
		() => ({
			message: zodErrorMsg.injectUrl,
		})
	)
	.refine(
		(config) => {
			if (
				(config.dataDirs !== undefined &&
					config.dataDirs !== null &&
					config.dataDirs?.length > 0) ||
				(config.linkDir !== undefined && config.linkDir !== null)
			) {
				return config.dataDirs?.length > 0 && config.linkDir;
			}
			return true;
		},
		() => ({
			message: zodErrorMsg.dataBased,
		})
	)
	.refine((config) => {
		if (config.skipRecheck && config.matchMode == MatchMode.RISKY) {
			logger.warn(zodErrorMsg.riskyRecheckWarn);
		}
		return true;
	});
