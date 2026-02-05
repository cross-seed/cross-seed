import { formOptions } from '@tanstack/react-form';
import { defaultConfig } from '../../../../shared/constants';
import { RuntimeConfig } from '../../../../shared/configSchema';
import { Action, LinkType, MatchMode } from '../../../../shared/constants';

export const formOpts = formOptions({
  defaultValues: defaultConfig,
  // qbittorrentUrl: null,
  // rtorrentRpcUrl: null,
  // transmissionRpcUrl: null,
  // delugeRpcUrl: null,
  // verbose: false,
  // torrents: [],
});

export const defaultGeneralFormValues: Partial<RuntimeConfig> = {
  blockList: [],
  autoResumeMaxDownload: 52428800,
  fuzzySizeThreshold: 1,
  ignoreNonRelevantFilesToResume: false,
  includeSingleEpisodes: false,
  includeNonVideos: false,
  seasonFromEpisodes: undefined,
  snatchTimeout: undefined,
};

export const defaultTrackerFormValues: Partial<RuntimeConfig> = {
  torznab: [],
};

export const defaultDownloadClientFormValues: Partial<RuntimeConfig> = {
  action: Action.INJECT,
  duplicateCategories: false,
  linkCategory: undefined,
  outputDir: '',
  skipRecheck: true,
  torrentClients: [],
  torrentDir: undefined,
  useClientTorrents: false,
};

export const defaultSearchFormValues: Partial<RuntimeConfig> = {
  delay: 30,
  excludeOlder: undefined,
  excludeRecentSearch: undefined,
  matchMode: MatchMode.STRICT,
  rssCadence: undefined,
  searchCadence: undefined,
  searchTimeout: undefined,
  searchLimit: undefined,
};

export const defaultConnectFormValues: Partial<RuntimeConfig> = {
  apiKey: undefined,
  host: undefined,
  notificationWebhookUrls: [],
  port: undefined,
  radarr: [],
  sonarr: [],
};

export const defaultDirectoriesFormValues: Partial<RuntimeConfig> = {
  dataDirs: [],
  flatLinking: false,
  injectDir: '',
  linkDirs: [],
  linkType: LinkType.HARDLINK,
  maxDataDepth: 2,
};
