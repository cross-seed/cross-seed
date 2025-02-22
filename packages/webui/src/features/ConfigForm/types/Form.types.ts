import { z } from 'zod';
import { ZodErrorMessages } from '../../../../../shared/constants';

export enum Action {
  SAVE = 'save',
  INJECT = 'inject',
}

export enum MatchMode {
  STRICT = 'strict',
  FLEXIBLE = 'flexible',
  PARTIAL = 'partial',
}

export enum LinkType {
  SYMLINK = 'symlink',
  HARDLINK = 'hardlink',
  REFLINK = 'reflink',
}

export const baseValidationSchema = z.object({
  delay: z
    .number()
    .nonnegative(ZodErrorMessages.delayNegative)
    .gte(import.meta.env.DEV ? 0 : 30, ZodErrorMessages.delayUnsupported)
    .lte(3600, ZodErrorMessages.delayUnsupported),
  torznab: z.array(z.string().url()),
  useClientTorrents: z.boolean(),
  dataDirs: z.array(z.string()).transform((v) => v ?? []),
  matchMode: z.nativeEnum(MatchMode),
  skipRecheck: z.boolean(),
  autoResumeMaxDownload: z
    .number()
    .int()
    .gte(0, ZodErrorMessages.autoResumeMaxDownloadUnsupported)
    .lte(52428800, ZodErrorMessages.autoResumeMaxDownloadUnsupported),
  linkCategory: z.string().nullish(),
  linkDir: z.string().nullish(),
  linkDirs: z.array(z.string()),
  linkType: z.nativeEnum(LinkType),
  flatLinking: z
    .boolean()
    .transform((v) => (typeof v === 'boolean' ? v : false)),
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
  torrentDir: z
    .string()
    .nullable()
    .transform((v) => v ?? null),
  outputDir: z.string(),
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
    // .transform(transformDurationString)
    .nullable(),
  excludeRecentSearch: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullable(),

  action: z.nativeEnum(Action),
  qbittorrentUrl: z.string().url().nullish(),
  rtorrentRpcUrl: z.string().url().nullish(),
  transmissionRpcUrl: z.string().url().nullish(),
  delugeRpcUrl: z.string().url().nullish(),
  duplicateCategories: z.boolean(),
  notificationWebhookUrls: z.array(z.string().url()),
  notificationWebhookUrl: z.string().url().nullish(),
  port: z.number().positive().lte(65535).nullish(),
  // .nullish(),
  host: z.string().ip().nullish(),
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
  snatchTimeout: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  searchTimeout: z
    .string()
    .min(1, ZodErrorMessages.emptyString)
    // .transform(transformDurationString)
    .nullish(),
  searchLimit: z.number().nonnegative().nullish(),
  verbose: z.boolean(),
  torrents: z.array(z.string()).optional(),
  blockList: z.array(z.string()).nullish(),
  // .transform(transformBlocklist),
  apiKey: z.string().min(24).nullish(),
  radarr: z.array(z.string().url()).transform((v) => v ?? []),
  sonarr: z.array(z.string().url()).transform((v) => v ?? []),
});
