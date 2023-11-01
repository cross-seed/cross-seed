import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";
import { logger } from "./logger.js";

/**
 * VALIDATION_SCHEMA is just a object of all the zod schemas
 * each are named after what they are intended to validate
 */

export const VALIDATION_SCHEMA = z
	.object({
		delay: z.number().gte(0, {
			message: "delay is in seconds, you can't travel back in time.",
		}),
		torznab: z.array(z.string().url()),
		dataDirs: z.array(z.string()).nullish(),
		matchMode: z.nativeEnum(MatchMode, {
			invalid_type_error: `matchMode must be either '${MatchMode.RISKY}' or '${MatchMode.SAFE}'`,
		}),
		dataCategory: z.string().nullish(),
		linkDir: z.string().nullish(),
		linkType: z.nativeEnum(LinkType, {
			invalid_type_error: `linkType must have a value of "${LinkType.HARDLINK}" or "${LinkType.SYMLINK}"`,
		}),
		skipRecheck: z.boolean(),
		maxDataDepth: z.number().gte(1, {
			message: "maxDataDepth must be a number greater than 0",
		}),
		torrentDir: z.string(),
		outputDir: z.string(),
		includeEpisodes: z.boolean({
			invalid_type_error:
				"includeEpisodes must be a defined boolean (true or false)",
		}),
		includeSingleEpisodes: z.boolean({
			invalid_type_error:
				"includeSingleEpisodes must be a defined boolean (true or false)",
		}),
		includeNonVideos: z.boolean({
			invalid_type_error:
				"includeNonVideos must be a defined boolean (true or false)",
		}),
		fuzzySizeThreshold: z.number().gte(0).lte(1, {
			message: "fuzzySizeThreshold must be a decimal percentage",
		}),
		excludeOlder: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your excludeOlder does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		excludeRecentSearch: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your excludeRecentSearch does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		action: z.nativeEnum(Action, {
			invalid_type_error: `action must be either '${Action.SAVE}' or '${Action.INJECT}'`,
		}),
		qbittorrentUrl: z.string().url().nullish(),
		rtorrentRpcUrl: z.string().url().nullish(),
		transmissionRpcUrl: z.string().url().nullish(),
		duplicateCategories: z.boolean({
			invalid_type_error:
				"duplicateCategories must be a defined boolean (true or false)",
		}),
		notificationWebhookUrl: z
			.string()
			.url({
				message: `invalid notificationWebhookUrl URL`,
			})
			.nullish(),
		port: z
			.number()
			.gte(1)
			.lte(65535, {
				message: "port must be a number between 1 and 65535",
			})
			.nullish(),
		rssCadence: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your rssCadence does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		searchCadence: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your searchCadence does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		snatchTimeout: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your snatchTimeout does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		searchTimeout: z.union([
			z.number().nullish(),
			z.nan().refine(() => {
				logger.warn(
					"your searchTimeout does not follow vercel's `ms` style"
				);
				return true;
			}),
		]),
		searchLimit: z.number().nullish(),
	})
	.refine(
		(config) =>
			config.action !== Action.INJECT ||
			config.rtorrentRpcUrl ||
			config.qbittorrentUrl ||
			config.transmissionRpcUrl,
		() => ({
			message:
				"You need to specify rtorrentRpcUrl, transmissionRpcUrl, or qbittorrentUrl when using 'inject'",
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
			message:
				"Data-Based Matching requires linkType, dataDirs, and linkDir to be defined",
		})
	)
	.refine((config) => {
		if (config.skipRecheck && config.matchMode == MatchMode.RISKY) {
			logger.warn(
				"It is strongly recommended to not skip rechecking for risky matching mode"
			);
		}
		return true;
	});
