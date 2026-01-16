import { z } from 'zod';
import { Action, LinkType, ZodErrorMessages } from '../../../shared/constants';
import { RUNTIME_CONFIG_SCHEMA } from '../../../shared/configSchema';

const runtimeShape = RUNTIME_CONFIG_SCHEMA.shape;

export const generalValidationSchema = z.object({
  includeSingleEpisodes: runtimeShape.includeSingleEpisodes,
  includeNonVideos: runtimeShape.includeNonVideos,
  blockList: runtimeShape.blockList.nullish(),
  snatchTimeout: runtimeShape.snatchTimeout.nullish(),
  autoResumeMaxDownload: runtimeShape.autoResumeMaxDownload,
  fuzzySizeThreshold: runtimeShape.fuzzySizeThreshold,
  seasonFromEpisodes: runtimeShape.seasonFromEpisodes.nullish(),
});

export const trackerValidationSchema = z.object({
  torznab: z.array(z.string().url()),
});

export const clientValidationSchema = z.object({
  client: z.string().min(1, ZodErrorMessages.emptyString),
  url: z.string().url(),
  user: z.string().nullish(),
  password: z.string().nullish(),
  readOnly: z
    .boolean()
    .optional()
    .default(false)
    .or(z.null().transform(() => false)),
  plugin: z.boolean().nullish().default(false),
});

export const downloaderValidationSchema = z.object({
  torrentClients: z.array(clientValidationSchema).nullish(),
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
  delay: runtimeShape.delay,
  matchMode: runtimeShape.matchMode,
  rssCadence: runtimeShape.rssCadence.nullish(),
  searchCadence: runtimeShape.searchCadence.nullish(),
  searchTimeout: runtimeShape.searchTimeout.nullish(),
  searchLimit: runtimeShape.searchLimit.nullish(),
  excludeOlder: runtimeShape.excludeOlder.nullish(),
  excludeRecentSearch: runtimeShape.excludeRecentSearch.nullish(),
});

export const connectValidationSchema = z.object({
  host: runtimeShape.host.nullish(),
  port: runtimeShape.port.nullish(),
  apiKey: runtimeShape.apiKey.nullish(),
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
  verbose: runtimeShape.verbose,
  torrents: runtimeShape.torrents.optional(),
});

export type Config = z.infer<typeof baseValidationSchema>;
