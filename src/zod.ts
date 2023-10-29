import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";
import { existsSync } from "fs";
import { logger } from "./logger.js";
import { getFileConfig } from "./configuration.js";

const fileConfig = await getFileConfig();

/**
 * VALIDATION_SCHEMA is just a object of all the zod schemas
 * each are named after what they are intended to validate
 */

export const VALIDATION_SCHEMA = z
	.object({
		notificationWebhookUrl: z.union([
			z.undefined(),
			z
				.string()
				.url()
				.refine((url) => ({
					message: `invalid notificationWebhookUrl URL - ${url}`,
				})),
		]),
		torznab: z.array(
			z
				.string()
				.url()
				.refine((url) => ({
					message: `invalid torznab URL - ${url}`,
				}))
		),
		dataDirs: z.union([
			z.undefined(),
			z.array(
				z.string().refine(
					(path) => existsSync(path),
					(path) => ({
						message: `the dataDirs path ${path} does not exist on the filesystem`,
					})
				)
			),
		]),
		torrentDir: z.string().refine(
			(path) => existsSync(path),
			(path) => ({
				message: `the torrentDir path ${path} does not exist on the filesystem`,
			})
		),
		linkDir: z.union([
			z.undefined(),
			z.string().refine(
				(path) => existsSync(path),
				(path) => ({
					message: `the linkDir path ${path} does not exist on the filesystem`,
				})
			),
		]),
		outputDir: z.string().refine(
			(path) => existsSync(path),
			(path) => ({
				message: `the outputDir path ${path} does not exist on the filesystem`,
			})
		),
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
		duplicateCategories: z.boolean({
			invalid_type_error:
				"duplicateCategories must be a defined boolean (true or false)",
		}),
		skipRecheck: z.boolean({
			invalid_type_error:
				"skipRecheck must be a defined boolean (true or false)",
		}),
		maxDataDepth: z.number().gte(1, {
			message: "maxDataDepth must be a number greater than 0",
		}),
		port: z.number().gte(1).lte(65535, {
			message: "port must be a number between 1 and 65535",
		}),
		searchLimit: z.union([z.number(), z.undefined()], {
			invalid_type_error: "searchLimit must be a number or undefined",
		}),
		delay: z.number().gt(1).lt(1000, {
			message:
				"delay is in seconds, >1000 implies you think it's milliseconds",
		}),
		action: z.nativeEnum(Action, {
			invalid_type_error: `action must be either '${Action.SAVE}' or '${Action.INJECT}'`,
		}),
		qbittorrentUrl: z.string().url().optional(),
		rtorrentRpcUrl: z.string().url().optional(),
		transmissionRpcUrl: z.string().url().optional(),

		matchMode: z.nativeEnum(MatchMode, {
			invalid_type_error: `matchMode must be either '${MatchMode.RISKY}' or '${MatchMode.SAFE}'`,
		}),
		linkType: z.nativeEnum(LinkType, {
			invalid_type_error: `linkType must have a value of "${LinkType.HARDLINK}" or "${LinkType.SYMLINK}"`,
		}),
		dataCategory: z.union([
			z.undefined(),
			z.string().min(1).max(24, {
				message: "dataCategory must have a length of 1-24 characters",
			}),
		]),
		fuzzySizeThreshold: z.number().gt(0).lt(1, {
			message:
				"fuzzySizeThreshold must be a decimal percentage greater than 0 and less than 1",
		}),
		searchCadence: z.union([
			z.number(),
			z.undefined(),
			z.nan().refine(
				() => {
					return typeof fileConfig.searchCadence === "undefined";
				},
				{
					message:
						"your searchCadence does not follow vercel's `ms` style",
				}
			),
		]),
		rssCadence: z.union([
			z.number(),
			z.undefined(),
			z.nan().refine(
				() => {
					return typeof fileConfig.rssCadence === "undefined";
				},
				{
					message:
						"your rssCadence does not follow vercel's `ms` style",
				}
			),
		]),
		excludeOlder: z.union([
			z.number(),
			z.undefined(),
			z.nan().refine(
				() => {
					return typeof fileConfig.excludeOlder === "undefined";
				},
				{
					message:
						"your excludeOlder does not follow vercel's `ms` style",
				}
			),
		]),
		excludeRecentSearch: z.union([
			z.number(),
			z.undefined(),
			z.nan().refine(
				() => {
					return (
						typeof fileConfig.excludeRecentSearch === "undefined"
					);
				},
				{
					message:
						"your excludeRecentSearch does not follow vercel's `ms` style",
				}
			),
		]),
	})
	.refine(
		(config) => {
			if (config.action === Action.INJECT) {
				return (
					config.rtorrentRpcUrl ||
					config.qbittorrentUrl ||
					config.transmissionRpcUrl
				);
			}
			return true;
		},
		() => ({
			message:
				"You need to specify rtorrentRpcUrl, transmissionRpcUrl, or qbittorrentUrl when using 'inject'.",
		})
	)
	.refine(
		(config) => {
			if (config.dataDirs || config.linkDir) {
				return config.dataDirs && config.linkDir && config.linkType;
			}
			return true;
		},
		() => ({
			message:
				"Data-Based Matching requires linkType, dataDirs, and linkDir to be defined.",
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
