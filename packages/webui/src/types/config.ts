import { z } from 'zod';
import {
  Action,
  LinkType,
  MatchMode,
  ZodErrorMessages,
} from '../../../shared/constants';

export const generalValidationSchema = z.object({
  includeSingleEpisodes: z.boolean(),
  includeNonVideos: z.boolean(),
  blockList: z.array(z.string()).nullish(),
  // .transform(transformBlocklist),
  snatchTimeout: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  autoResumeMaxDownload: z
    .number()
    .int()
    .gte(0, ZodErrorMessages.autoResumeMaxDownloadUnsupported)
    .lte(52428800, ZodErrorMessages.autoResumeMaxDownloadUnsupported),
  fuzzySizeThreshold: z
    .number()
    .positive()
    .lte(1, ZodErrorMessages.numberMustBeRatio),
  seasonFromEpisodes: z
    .number()
    .positive()
    .lte(1, ZodErrorMessages.numberMustBeRatio)
    .nullish(),
});

export const trackerValidationSchema = z.object({
  torznab: z.array(z.string().url()),
});

export const downloaderValidationSchema = z.object({
  torrentClients: z
    .array(
      z.object({
        name: z.string().min(1, ZodErrorMessages.emptyString).nullish(),
        client: z.string().min(1, ZodErrorMessages.emptyString),
        url: z.string().url(),
        user: z.string(),
        password: z.string(),
        readOnly: z.boolean().optional(),
      }),
    )
    .nullish(),
  // torrentClients: z.array(z.string()).nullish(),
  // qbittorrentUrl: z.string().url().nullish(),
  // rtorrentRpcUrl: z.string().url().nullish(),
  // transmissionRpcUrl: z.string().url().nullish(),
  // delugeRpcUrl: z.string().url().nullish(),
  action: z.nativeEnum(Action),
  duplicateCategories: z.boolean(),
  useClientTorrents: z.boolean(),
  linkCategory: z.string().nullish(),
  skipRecheck: z.boolean(),
  torrentDir: z
    .string()
    .nullable()
    .transform((v) => v ?? null),
  outputDir: z.string().min(1, ZodErrorMessages.emptyString),
  injectDir: z.string().optional(),
});

export const searchValidationSchema = z.object({
  delay: z
    .number()
    .nonnegative(ZodErrorMessages.delayNegative)
    .gte(30, ZodErrorMessages.delayUnsupported)
    .lte(3600, ZodErrorMessages.delayUnsupported),
  matchMode: z.nativeEnum(MatchMode),
  rssCadence: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  // .refine(
  // 	(cadence) =>
  // 		process.env.DEV ||
  // 		!cadence ||
  // 		(cadence >= ms("10 minutes") && cadence <= ms("2 hours")),
  // 	ZodErrorMessages.rssCadenceUnsupported,
  // ),
  searchCadence: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  // .refine(
  // 	(cadence) =>
  // 		process.env.DEV || !cadence || cadence >= ms("1 day"),
  // 	ZodErrorMessages.searchCadenceUnsupported,
  // ),
  searchTimeout: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  searchLimit: z.number().nonnegative().nullish(),
  excludeOlder: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullable(),
  excludeRecentSearch: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullable(),
});

export const connectValidationSchema = z.object({
  host: z.string().ip().nullish(),
  port: z.number().positive().lte(65535).nullish(),
  // .nullish(),
  apiKey: z.string().min(24).nullish(),
  radarr: z
    .array(z.string().url().or(z.literal('')))
    .transform((v) => v ?? [])
    .nullable(),
  sonarr: z
    .array(z.string().url().or(z.literal('')))
    .transform((v) => v ?? [])
    .nullable(),
  notificationWebhookUrls: z
    .array(z.string().url().or(z.literal('')))
    .optional(),
});

export const directoryValidationSchema = z.object({
  dataDirs: z
    .array(z.string())
    .transform((v) => v ?? [])
    .nullable(),
  flatLinking: z
    .boolean()
    .transform((v) => (typeof v === 'boolean' ? v : false)),
  linkDir: z.string().nullish(),
  linkDirs: z.array(z.string()).nullable(),
  linkType: z.nativeEnum(LinkType),
  maxDataDepth: z
    .number()
    .gte(1)
    .refine((maxDataDepth) => {
      if (maxDataDepth > 3) {
        console.error(
          `Your maxDataDepth is most likely incorrect, please read: https://www.cross-seed.org/docs/tutorials/data-based-matching#setting-up-data-based-matching`,
        );
      }
      return true;
    }),
});

export const baseValidationSchema = z.object({
  verbose: z.boolean(),
  torrents: z.array(z.string()).optional(),
});

export type Config = z.infer<typeof baseValidationSchema>;
